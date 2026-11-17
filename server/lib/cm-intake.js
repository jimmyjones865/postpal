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
    folder: process.env.MAIL_FOLDER || 'INBOX',
    dryRun: process.env.CM_DRY_RUN !== 'false',
    maxPriceCents: Math.round(envNum('CM_MAX_PRICE_EUR', 6) * 100),
    dailyCap: envNum('CM_DAILY_CAP', 30),
    pollMs: envNum('CM_POLL_SECONDS', 120) * 1000
  };
  if (!cfg.host || !cfg.user || !cfg.pass) {
    logger.info('[CM] MAIL_SERVER/MAIL_USERNAME/MAIL_PASSWORD not set, email intake off');
    return;
  }

  const statePath = path.join(storagePath, 'cm-orders.json');
  const costTablePath = process.env.CM_SHIPPING_PATH || new URL('../cm-shipping.json', import.meta.url).pathname;
  const productsPath = path.join(process.env.STATIC_PATH || new URL('../../public', import.meta.url).pathname, 'products.json');
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

  async function processMail(subjectOrderId, text) {
    const costTable = JSON.parse(await fs.readFile(costTablePath, 'utf8'));
    const products = JSON.parse(await fs.readFile(productsPath, 'utf8'));
    const parsed = { subjectOrderId, ...parseBody(text) };
    const decision = decide(parsed, { costTable, products, boughtToday: boughtToday(), maxPriceCents: cfg.maxPriceCents, dailyCap: cfg.dailyCap });
    const rawAddress = parsed.addressLines?.join('\n') ?? '(none)';

    if (!decision.ok) {
      await record(subjectOrderId, 'skipped', { reason: decision.reason });
      await notify(`🛑 CM ${subjectOrderId}: no label — ${decision.reason}\n\`\`\`\n${rawAddress}\n\`\`\``);
      return;
    }

    const { product, priceCents, receiver, recipientAddress } = decision;
    if (cfg.dryRun) {
      await record(subjectOrderId, 'dry-run', { productCode: product.code });
      await notify(`🧪 CM ${subjectOrderId}: would buy ${product.name} (${product.cost} €)\n\`\`\`\n${recipientAddress}\n\`\`\``);
      return;
    }

    // Persisted before the DHL call: purchase is not idempotent, a crash must not lead to a second buy
    await record(subjectOrderId, 'processing', { productCode: product.code });

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
      await notify(`🛑 CM ${subjectOrderId}: purchase failed — ${[result.error, result.details].filter(Boolean).join(' — ')}\n\`\`\`\n${recipientAddress}\n\`\`\``);
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
    await notify(`✅ CM ${subjectOrderId}: ${product.name} ${product.cost} €${balance}, ${printNote}`);
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
      const lock = await client.getMailboxLock(cfg.folder, { readOnly: true });
      try {
        const startedAt = new Date(state.startedAt);
        const uids = await client.search({ since: startedAt }, { uid: true });
        const candidates = [];
        if (uids?.length) {
          for await (const msg of client.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
            const orderId = matchSubject(msg.envelope?.subject);
            if (orderId && !state.orders[orderId] && msg.internalDate >= startedAt) {
              candidates.push({ uid: msg.uid, orderId });
            }
          }
        }
        for (const { uid, orderId } of candidates) {
          if (state.orders[orderId]) continue; // same order mailed twice in one poll
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          const mail = await simpleParser(msg.source);
          logger.info(`[CM] Processing order ${orderId}`);
          await processMail(orderId, mail.text);
        }
      } finally {
        lock.release();
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
      logger.info(`[CM] Email intake on (${cfg.dryRun ? 'DRY RUN' : 'LIVE'}), polling ${cfg.folder} every ${cfg.pollMs / 1000}s, since ${state.startedAt}`);
      poll();
      setInterval(poll, cfg.pollMs);
    })
    .catch(err => logger.error('[CM] Intake start failed:', err.message));
}
