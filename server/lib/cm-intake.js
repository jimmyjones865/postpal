// Cardmarket order email → label bought + printed. Polls IMAP read-only; never touches flags or folders.

import fs from 'fs/promises';
import path from 'path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';
import { matchSubject, parseBody, decide } from './cm-email.js';
import { getCountryCode } from './country-codes.js';
import { loadServerConfig } from './config.js';
import { buyLabel } from './purchase.js';
import { printStoredLabel } from './print-label.js';
import { notify } from './discord.js';

const envNum = (key, fallback) => {
  const n = parseFloat(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
};

export function startCmIntake({ storage, dhlClient, getCredentials, storagePath }) {
  const cfg = {
    host: process.env.MAIL_SERVER,
    port: envNum('MAIL_PORT', 993),
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD,
    // Mail is moved to Archive quickly, so both are watched by default
    folders: (process.env.MAIL_FOLDER || 'INBOX,Archive').split(',').map(f => f.trim()).filter(Boolean),
    dryRun: process.env.CM_DRY_RUN !== 'false',
    maxPriceCents: Math.round(envNum('CM_MAX_PRICE_EUR', 6) * 100),
    dailyCap: envNum('CM_DAILY_CAP', 30),
    pollMs: envNum('CM_POLL_SECONDS', 120) * 1000,
    topupCents: Math.round(envNum('AUTO_TOPUP_EUR', 0) * 100)
  };
  // Default = one top-up per day: a mistake (loop, wrong price) costs at most one charge
  cfg.topupDailyMaxCents = Math.round(envNum('AUTO_TOPUP_DAILY_MAX_EUR', cfg.topupCents / 100) * 100);
  const topupMaxCents = Math.round(envNum('TOPUP_MAX_EUR', 50) * 100);
  if (cfg.topupCents && (cfg.topupCents < 1000 || cfg.topupCents > topupMaxCents)) {
    logger.warn(`[CM] AUTO_TOPUP_EUR must be 10–${topupMaxCents / 100} (DHL min, TOPUP_MAX_EUR); auto top-up off`);
    cfg.topupCents = 0;
  }
  if (!cfg.host || !cfg.user || !cfg.pass) {
    logger.info('[CM] MAIL_SERVER/MAIL_USERNAME/MAIL_PASSWORD not set, email intake off');
    return;
  }

  const statePath = path.join(storagePath, 'cm-orders.json');
  const costTablePath = process.env.CM_SHIPPING_PATH || new URL('../cm-shipping.json', import.meta.url).pathname;
  const productsPath = path.join(process.env.STATIC_PATH || new URL('../public', import.meta.url).pathname, 'products.json');
  let state;
  let running = false;
  let failing = false;

  async function saveState() {
    const tmp = `${statePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, statePath);
  }

  async function loadState() {
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // First start: only mail arriving from now on, never backfill
      state = { startedAt: new Date().toISOString(), orders: {} };
      await saveState();
    }
    const interrupted = Object.entries(state.orders).filter(([, o]) => o.status === 'processing');
    for (const [id, order] of interrupted) {
      order.status = 'interrupted';
      await notify(`⚠️ CM ${id}: restart during purchase — check Portokasse/history, no retry.`);
    }
    if (interrupted.length) await saveState();
  }

  function boughtToday() {
    const today = new Date().toISOString().slice(0, 10);
    return Object.values(state.orders).filter(o => o.status === 'bought' && o.at.startsWith(today)).length;
  }

  async function record(orderId, status, detail) {
    state.orders[orderId] = { status, at: new Date().toISOString(), ...detail };
    await saveState();
  }

  const day = () => new Date().toISOString().slice(0, 10);
  const toppedUpToday = () => (state.topups || []).filter(t => t.at.startsWith(day())).reduce((sum, t) => sum + t.cents, 0);
  const eur = cents => (cents / 100).toFixed(2);

  /** Balance too low for this label? Returns { needed, balance }. */
  async function topupCheck(priceCents) {
    if (!cfg.topupCents) return { needed: false };
    // Forced refresh: the cached balance misses top-ups made on the Portokasse website
    const token = await dhlClient.getAccessToken(getCredentials(), true);
    const balance = token.walletBalance;
    return { needed: balance < priceCents, balance, accessToken: token.accessToken };
  }

  /** Tops up if needed. Never throws: a failed top-up must not block a label the balance still covers. */
  async function maybeTopUp(priceCents) {
    try {
      const { needed, balance, accessToken } = await topupCheck(priceCents);
      if (!needed) return;
      if (toppedUpToday() + cfg.topupCents > cfg.topupDailyMaxCents) {
        if (state.topupCapNotified !== day()) {
          state.topupCapNotified = day();
          await saveState();
          await notify(`⚠️ Auto top-up: daily cap ${eur(cfg.topupDailyMaxCents)} € reached, balance ${eur(balance)} €. Labels fail until you top up manually.`);
        }
        return;
      }
      const result = await dhlClient.chargeWallet(accessToken, cfg.topupCents);
      if (!result.success) {
        let title;
        try { title = JSON.parse(result.details).title; } catch { /* non-JSON body */ }
        await notify(`🛑 Auto top-up ${eur(cfg.topupCents)} € failed: ${title || result.status} — balance ${eur(balance)} €.`);
        return;
      }
      (state.topups ||= []).push({ at: new Date().toISOString(), cents: cfg.topupCents });
      await saveState();
      await notify(`💶 Auto top-up ${eur(cfg.topupCents)} € → balance ${eur(result.newBalance)} € (${eur(toppedUpToday())} € today)`);
    } catch (err) {
      await notify(`🛑 Auto top-up error: ${err.message}`);
    }
  }

  async function processMail(subjectOrderId, buyer, text, { costTable, products }) {
    const who = `\n👤 ${buyer}`;
    const parsed = { subjectOrderId, ...parseBody(text) };
    const decision = decide(parsed, { costTable, products, boughtToday: boughtToday(), maxPriceCents: cfg.maxPriceCents, dailyCap: cfg.dailyCap });
    const rawAddress = parsed.addressLines?.join('\n') ?? '(none)';

    if (!decision.ok) {
      await record(subjectOrderId, 'skipped', { reason: decision.reason });
      await notify(`🛑 CM ${subjectOrderId}: no label — ${decision.reason}${who}\n\`\`\`\n${rawAddress}\n\`\`\``);
      return;
    }

    const { product, priceCents, receiver, recipientAddress } = decision;
    if (cfg.dryRun) {
      await record(subjectOrderId, 'dry-run', { productCode: product.code });
      const t = await topupCheck(priceCents).catch(err => ({ error: err.message }));
      const topupNote = t.error ? `, top-up check failed: ${t.error}`
        : t.needed ? `, would top up ${eur(cfg.topupCents)} € (balance ${eur(t.balance)} €)` : '';
      await notify(`🧪 CM ${subjectOrderId}: would buy ${product.name} (${product.cost} €)${topupNote}${who}\n\`\`\`\n${recipientAddress}\n\`\`\``);
      return;
    }

    // Persisted before the DHL call: purchase is not idempotent, a crash must not lead to a second buy
    await record(subjectOrderId, 'processing', { productCode: product.code });
    await maybeTopUp(priceCents);

    const server = loadServerConfig();
    const s = server.senderAddress || {};
    const printer = server.printerConfig || {};
    let result;
    try {
      result = await buyLabel({ storage, dhlClient, credentials: getCredentials() }, {
        sender: {
          name: s.name,
          additionalName: s.company,
          addressLine1: s.street,
          postalCode: s.postalCode,
          city: s.city,
          country: getCountryCode(s.country)
        },
        receiver,
        productCode: product.code,
        productName: product.name,
        priceInCents: priceCents,
        pageFormatId: printer.paperFormatId,
        recipientAddress,
        meta: { cmOrderId: subjectOrderId }
      });
    } catch (err) {
      result = { success: false, error: err.message };
    }

    if (!result.success) {
      await record(subjectOrderId, result.paid ? 'bought-unstored' : 'failed', { productCode: product.code, error: result.error });
      await notify(`🛑 CM ${subjectOrderId}: purchase failed — ${[result.error, result.details].filter(Boolean).join(' — ')}${who}\n\`\`\`\n${recipientAddress}\n\`\`\``);
      return;
    }

    await record(subjectOrderId, 'bought', { productCode: product.code, labelId: result.label.id });
    const balance = result.newBalance != null ? `, balance ${(result.newBalance / 100).toFixed(2)} €` : '';
    let printNote = 'not printed (direct print off)';
    if (printer.enableDirectPrint && printer.cupsUrl && printer.printerName) {
      const p = await printStoredLabel(storage, result.label.id, {
        cupsUrl: printer.cupsUrl,
        printerName: printer.printerName,
        orientation: printer.orientation,
        cropTop: printer.cropMarginTop,
        cropRight: printer.cropMarginRight,
        cropBottom: printer.cropMarginBottom,
        cropLeft: printer.cropMarginLeft,
        disableCropping: printer.disableCropping,
        paperWidthMm: printer.paperWidthMm,
        paperHeightMm: printer.paperHeightMm,
        endlessRoll: printer.endlessRoll
      }).catch(err => ({ success: false, error: err.message }));
      printNote = p.success ? 'printed' : `print failed (${p.error}) — reprint from history`;
    }
    await notify(`✅ CM ${subjectOrderId}: ${product.name} ${product.cost} €${balance}, ${printNote}${who}`);
  }

  async function poll() {
    if (running) return;
    running = true;
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 993,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false
    });
    client.on('error', err => logger.warn('[CM] IMAP error:', err.message));
    try {
      await client.connect();
      const tables = {
        costTable: JSON.parse(await fs.readFile(costTablePath, 'utf8')),
        products: JSON.parse(await fs.readFile(productsPath, 'utf8'))
      };
      const startedAt = new Date(state.startedAt);
      // 7-day lookback bounds the search as the archive grows; covers up to a week of downtime
      const since = new Date(Math.max(startedAt, Date.now() - 7 * 86_400_000));
      for (const folder of cfg.folders) {
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const uids = await client.search(
            { since, or: [{ subject: 'Bitte versenden' }, { subject: 'Please ship' }] },
            { uid: true }
          ) || [];
          const candidates = [];
          // Chunked: servers cap command length (4096 bytes seen)
          for (let i = 0; i < uids.length; i += 200) {
            for await (const msg of client.fetch(uids.slice(i, i + 200), { envelope: true, internalDate: true }, { uid: true })) {
              const { orderId, buyer } = matchSubject(msg.envelope?.subject) || {};
              if (orderId && !state.orders[orderId] && msg.internalDate >= startedAt) {
                candidates.push({ uid: msg.uid, orderId, buyer });
              }
            }
          }
          for (const { uid, orderId, buyer } of candidates) {
            if (state.orders[orderId]) continue; // same order mailed twice in one poll
            const msg = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!msg?.source) continue; // moved to another folder since the search; found there next poll
            logger.info(`[CM] Processing order ${orderId} (${folder})`);
            try {
              const mail = await simpleParser(msg.source);
              await processMail(orderId, buyer, mail.text, tables);
            } catch (err) {
              // Recorded so one broken mail can't block every later order
              logger.error(`[CM] Order ${orderId} failed:`, err);
              if (!state.orders[orderId] || state.orders[orderId].status === 'processing') {
                await record(orderId, 'error', { error: err.message });
              }
              await notify(`🛑 CM ${orderId}: error — ${err.message}. Do it manually, no retry.\n👤 ${buyer}`);
            }
          }
        } finally {
          lock.release();
        }
      }
      await client.logout();
      if (failing) await notify('✅ CM mail polling recovered.');
      failing = false;
    } catch (err) {
      logger.error('[CM] Poll failed:', err.message);
      if (!failing) await notify(`⚠️ CM mail polling failing: ${err.message}`);
      failing = true;
      client.close();
    } finally {
      running = false;
    }
  }

  loadState()
    .then(() => {
      logger.info(`[CM] Email intake on (${cfg.dryRun ? 'DRY RUN' : 'LIVE'}), polling ${cfg.folders.join(' + ')} every ${cfg.pollMs / 1000}s, since ${state.startedAt}, auto top-up ${cfg.topupCents ? `${eur(cfg.topupCents)} € when balance < label, max ${eur(cfg.topupDailyMaxCents)} €/day` : 'off'}`);
      poll();
      setInterval(poll, cfg.pollMs);
    })
    .catch(err => logger.error('[CM] Intake start failed:', err.message));
}
