// Cardmarket order email → label bought + printed. Handled mails (bought / Paket pay link) are marked read and archived.

import fs from 'fs/promises';
import path from 'path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from './logger.js';
import { matchSubject, parseBody, decide, topHeader, senderProblem, itemBlock } from './cm-email.js';
import { getCountryCode } from './country-codes.js';
import { envNum, berlinDay } from './config.js';
import { buyLabel, recoverLabel } from './purchase.js';
import { printWithSettings } from './print-label.js';
import { notify } from './discord.js';
import { archiveMails, archiveFolderFromEnv } from './mail-archive.js';
import { MIN_TOPUP_CENTS, TOPUP_MAX_CENTS, TOPUP_DAILY_MAX_CENTS, chargeErrorTitle } from './topups.js';
import { parseWindow, printWindowState, showWindow } from './print-window.js';
import { pakProductName } from './paket.js';

// Dedupe needs entries back to the 7-day lookback (IMAP SINCE is day-granular); 14 leaves margin
const KEEP_MS = 14 * 86_400_000;
// Statuses where DHL definitely took no money; everything else with a product counts toward the cap
const NOT_SPENT = new Set(['dry-run', 'failed', 'retry']);
// Looked up by shopOrderId each poll until bought or confirmed not bought
const RECOVER = new Set(['uncertain', 'bought-unstored', 'interrupted', 'error']);
// Gives DHL time to finish a checkout whose response was lost before a 404 is trusted
const RECOVER_AFTER_MS = 60_000;
// Mail seen but not processed yet: picked up again on the next poll
const WAITING = new Set(['retry', 'queued']);
// Mail no longer needed: label bought or Paket order created. Others stay in the inbox as a to-do.
const ARCHIVE = new Set(['bought', 'paket']);
export const TRACK_URL = 'https://www.deutschepost.de/en/s/shipment-tracking.html?piececode=';

let stopping = false;
let current = Promise.resolve();
let timer;

/** Stops polling; resolves once an in-flight poll has finished its current order. */
export function stopCmIntake() {
  stopping = true;
  clearInterval(timer);
  return current;
}

export function startCmIntake({ storage, dhlClient, getCredentials, topups, settings, storagePath, paket }) {
  const cfg = {
    host: process.env.MAIL_SERVER,
    port: envNum('MAIL_PORT', 993),
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD,
    // Mail is moved to Archive quickly, so both are watched by default
    folders: (process.env.MAIL_FOLDER || 'INBOX,Archive').split(',').map(f => f.trim()).filter(Boolean),
    archiveFolder: archiveFolderFromEnv(),
    itemsList: process.env.DISCORD_MESSAGE_ITEMS_LIST !== 'false',
    pollMs: envNum('MAIL_POLL_SECONDS', 120) * 1000
  };
  const warned = new Set();
  const warnOnce = msg => { if (!warned.has(msg)) { warned.add(msg); logger.warn(msg); } };

  /** UI-editable values (settings.json over env), re-read at the start of every poll. */
  function applySettings() {
    const s = settings.get().intake;
    cfg.dryRun = s.dryRun;
    cfg.dailyCap = s.maxLabelsPerDay;
    cfg.topupCents = Math.round(s.autoTopupEur * 100);
    cfg.topupDailyMaxCents = Math.round(s.autoTopupDailyMaxEur * 100);
    if (cfg.topupCents && (cfg.topupCents < MIN_TOPUP_CENTS || cfg.topupCents > TOPUP_MAX_CENTS)) {
      warnOnce(`[CM] auto top-up must be ${MIN_TOPUP_CENTS / 100}–${TOPUP_MAX_CENTS / 100} € (DHL min, TOPUP_MAX_EUR); auto top-up off`);
      cfg.topupCents = 0;
    }
    cfg.windows = {};
    for (const [key, name] of [['weekday', 'printWindowWeekday'], ['weekend', 'printWindowWeekend']]) {
      try {
        cfg.windows[key] = parseWindow(s[name]);
      } catch (err) {
        warnOnce(`[CM] ${name}: ${err.message}; printing around the clock`);
        cfg.windows[key] = null;
      }
    }
  }
  applySettings();
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

  /** What live mode needs that is missing; checked once so a bad config can't top up and then fail every order. */
  function liveConfigProblems() {
    const c = getCredentials();
    const s = settings.get().senderAddress;
    const missing = [
      ...['apiKey', 'apiSecret', 'portokasseLogin', 'portokassePassword'].filter(k => !c[k]).map(k => `DHL ${k}`),
      ...['name', 'street', 'postalCode', 'city'].filter(k => !s[k]).map(k => `SENDER ${k}`)
    ];
    if (!getCountryCode(s.country)) missing.push(`SENDER_COUNTRY "${s.country ?? ''}"`);
    return missing;
  }

  async function saveState() {
    const cutoff = Date.now() - KEEP_MS;
    for (const map of [state.orders, state.foreign]) {
      for (const [id, o] of Object.entries(map)) if (Date.parse(o.at) < cutoff) delete map[id];
    }
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
    }
    state.foreign ||= {};
    delete state.topups; // moved to topups.json
    const interrupted = Object.entries(state.orders).filter(([, o]) => o.status === 'processing');
    for (const [id, order] of interrupted) {
      order.status = 'interrupted';
      await notify(`⚠️ CM ${id}: restart during purchase — checking DHL${order.shopOrderId ? ` (order ${order.shopOrderId})` : ''} on the next poll.`);
    }
    await saveState();
  }

  function boughtToday() {
    const today = berlinDay();
    return Object.values(state.orders)
      .filter(o => o.productCode && !NOT_SPENT.has(o.status) && berlinDay(o.at) === today).length;
  }

  async function record(orderId, status, detail) {
    state.orders[orderId] = { status, at: new Date().toISOString(), ...detail };
    await saveState();
  }

  const eur = cents => (cents / 100).toFixed(2);

  /** Balance too low for this label? Returns { needed, balance, accessToken }. Unknown balance → not needed + unknown. */
  async function topupCheck(priceCents) {
    if (!cfg.topupCents) return { needed: false };
    // Forced refresh: the cached balance misses top-ups made on the Portokasse website
    const token = await dhlClient.getAccessToken(getCredentials(), true);
    const balance = token.walletBalance;
    if (typeof balance !== 'number') return { needed: false, unknown: true };
    return { needed: balance < priceCents, balance, accessToken: token.accessToken };
  }

  /** Tops up if needed. Never throws: a failed top-up must not block a label the balance still covers. */
  async function maybeTopUp(priceCents) {
    try {
      const { needed, unknown, balance, accessToken } = await topupCheck(priceCents);
      if (unknown) {
        await notify('⚠️ Auto top-up skipped: DHL did not report the balance.');
        return;
      }
      if (!needed) return;
      const auto = await topups.todayCents('auto');
      const all = await topups.todayCents();
      const capHit = auto + cfg.topupCents > cfg.topupDailyMaxCents ? `auto top-up daily cap ${eur(cfg.topupDailyMaxCents)} €`
        : all + cfg.topupCents > TOPUP_DAILY_MAX_CENTS ? `total top-up daily cap ${eur(TOPUP_DAILY_MAX_CENTS)} € (UI + auto)` : null;
      if (capHit) {
        if (state.topupCapNotified !== berlinDay()) {
          state.topupCapNotified = berlinDay();
          await saveState();
          await notify(`⚠️ Auto top-up: ${capHit} reached, balance ${eur(balance)} €. Labels fail until you top up manually.`);
        }
        return;
      }
      const result = await topups.charge(dhlClient, accessToken, cfg.topupCents, 'auto');
      if (!result.success) {
        await notify(`🛑 Auto top-up ${eur(cfg.topupCents)} € failed: ${chargeErrorTitle(result)} — balance ${eur(balance)} €.`);
        return;
      }
      const after = result.newBalance != null ? eur(result.newBalance) : '?';
      await notify(`💶 Auto top-up ${eur(cfg.topupCents)} € → balance ${after} € (${eur(await topups.todayCents('auto'))} € auto today)`);
    } catch (err) {
      await notify(`🛑 Auto top-up error: ${err.message} — if the charge was sent, check Portokasse (it counts toward the daily cap).`);
    }
  }

  async function processMail(subjectOrderId, buyer, text, { costTable, products }) {
    const parsed = { subjectOrderId, ...parseBody(text) };
    const n = parsed.itemCount ?? '?';
    const summary = `${buyer}: ${n} item${n === 1 ? '' : 's'} @ ${parsed.totalEur ?? '?'} €`;
    const itemList = cfg.itemsList ? itemBlock(parsed.items) : '';
    const say = line => notify(`${summary}\n${line}${itemList}`);
    const decision = decide(parsed, { costTable, products, boughtToday: boughtToday(), dailyCap: cfg.dailyCap });
    const rawAddress = parsed.addressLines?.join('\n') ?? '(none)';
    // Shown in the UI intake view
    const shown = { buyer, summary, itemList };

    if (!decision.ok) {
      await record(subjectOrderId, 'skipped', { reason: decision.reason, ...shown, recipientAddress: rawAddress });
      await say(`🛑 CM ${subjectOrderId}: no label — ${decision.reason}\n\`\`\`\n${rawAddress}\n\`\`\``);
      return;
    }

    const { product, priceCents, receiver, recipientAddress } = decision;
    if (decision.paket) {
      await paketOrder(subjectOrderId, { shown, buyer, summary, itemList, say, receiver, recipientAddress, ...decision.paket });
      return;
    }
    if (cfg.dryRun) {
      await record(subjectOrderId, 'dry-run', { productCode: product.code, productName: product.name, ...shown, recipientAddress });
      const t = await topupCheck(priceCents).catch(err => ({ error: err.message }));
      const topupNote = t.error ? `, top-up check failed: ${t.error}`
        : t.unknown ? ', balance unknown (no top-up)'
        : t.needed ? `, would top up ${eur(cfg.topupCents)} € (balance ${eur(t.balance)} €)` : '';
      await say(`🧪 CM ${subjectOrderId}: would buy ${product.name} (${product.cost} €)${topupNote}\n\`\`\`\n${recipientAddress}\n\`\`\``);
      return;
    }

    // Persisted before the DHL call; shopOrderId added once reserved, so a crash or lost response can be looked up
    const prev = state.orders[subjectOrderId];
    const base = { productCode: product.code, productName: product.name, tracked: !!product.tracked, recipientAddress, buyer, summary, itemList, attempts: prev?.attempts || 0 };
    let shopOrderId = prev?.status === 'retry' ? prev.shopOrderId : undefined;
    await record(subjectOrderId, 'processing', { ...base, shopOrderId });
    await maybeTopUp(priceCents);

    const s = settings.get().senderAddress;
    const result = await buyLabel({ storage, dhlClient, credentials: getCredentials() }, {
      shopOrderId,
      beforeCheckout: async id => {
        shopOrderId = id;
        base.checkoutSent = true;
        await record(subjectOrderId, 'processing', { ...base, shopOrderId });
      },
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
      pageFormatId: settings.get().printerConfig.paperFormatId || undefined,
      recipientAddress,
      meta: { cmOrderId: subjectOrderId }
    }).catch(err => ({ success: false, error: err.message })); // thrown = before checkout (auth, cart init)

    if (!result.success) {
      shopOrderId = result.shopOrderId || shopOrderId;
      const status = result.paid ? 'bought-unstored' : result.uncertain ? 'uncertain' : 'failed';
      const head = status === 'failed' ? 'purchase failed'
        : shopOrderId ? `label may be paid — looking up order ${shopOrderId} automatically, don't buy it manually`
        : 'label may be paid — check Portokasse/history before buying manually';
      await record(subjectOrderId, status, { ...base, shopOrderId, error: result.error });
      await say(`${status === 'failed' ? '🛑' : '⏳'} CM ${subjectOrderId}: ${head} — ${[result.error, result.details].filter(Boolean).join(' — ')}\n\`\`\`\n${recipientAddress}\n\`\`\``);
      return;
    }

    await finishBought(subjectOrderId, { ...base, shopOrderId: result.label.shopOrderId }, result, `${product.name} ${product.cost} €`);
  }

  /** DHL Paket: no purchase here — an order awaiting manual payment via the pay link. Nothing is spent, so no cap. */
  async function paketOrder(orderId, { shown, buyer, summary, itemList, say, receiver, recipientAddress, productId, insurance }) {
    const productName = pakProductName(productId, insurance);
    const price = await paket?.quote(productId, insurance, receiver.country);
    const what = `${productName}${price != null ? ` (${price.toFixed(2)} €)` : ''}`;
    if (!paket) {
      await record(orderId, 'skipped', { reason: 'DHL Paket not configured', ...shown, recipientAddress });
      await say(`🛑 CM ${orderId}: ${what} — DHL Paket not configured, buy it manually.`);
      return;
    }
    if (cfg.dryRun) {
      await record(orderId, 'dry-run', { paketProduct: productId, insurance, productName, ...shown, recipientAddress });
      await say(`🧪 CM ${orderId}: would create ${what} pay link\n\`\`\`\n${recipientAddress}\n\`\`\``);
      return;
    }
    const { payMd, openCount, payAllMd } = await paket.addOrder({ id: orderId, source: 'cm', cmOrderId: orderId, productId, productName, insurance, receiver, recipientAddress, buyer, summary, itemList });
    await record(orderId, 'paket', { paketProduct: productId, insurance, productName, ...shown, recipientAddress });
    const payAll = openCount > 1 ? `\n💳 All ${openCount} open in one payment: ${payAllMd}` : '';
    await say(`💳 CM ${orderId}: ${what} — ${payMd}${payAll}\n\`\`\`\n${recipientAddress}\n\`\`\``);
  }

  /** Records a stored label, prints it, posts ✅. */
  async function finishBought(orderId, base, { label, newBalance }, what) {
    await record(orderId, 'bought', { ...base, labelId: label.id });
    const balance = newBalance != null ? `, balance ${(newBalance / 100).toFixed(2)} €` : '';
    const p = await printWithSettings(storage, settings, label.id).catch(err => ({ success: false, error: err.message }));
    const printNote = p.skipped ? 'not printed (direct print off)' : p.success ? 'printed' : `print failed (${p.error}) — reprint from history`;
    // DHL sends trackId only for international Einschreiben; domestic ones are tracked by voucherId
    const trackId = base.tracked && (label.trackId || label.voucherId);
    const tracking = trackId ? `\n📦 ${trackId} [Tracking](<${TRACK_URL}${encodeURIComponent(trackId)}>)` : '';
    const address = base.recipientAddress ? `\n\`\`\`\n${base.recipientAddress}\n\`\`\`` : '';
    await notify(`${base.summary ?? base.buyer}\n✅ CM ${orderId}: ${what}${balance}, ${printNote}${tracking}${address}${base.itemList ?? ''}`);
  }

  /**
   * Resolves orders whose purchase outcome is unclear by looking up their shopOrderId at DHL.
   * Found → stored + printed. 404 → not bought: one retry with the same shopOrderId (DHL refuses a second checkout).
   */
  async function recoverPending() {
    const ctx = { storage, dhlClient, credentials: getCredentials() };
    for (const [orderId, o] of Object.entries(state.orders)) {
      if (stopping) return;
      if (!RECOVER.has(o.status) || !o.productCode || Date.now() - Date.parse(o.at) < RECOVER_AFTER_MS) continue;
      const say = line => notify(`${o.summary ?? o.buyer}\n${line}`);
      const keep = { ...o };
      delete keep.status;
      delete keep.at;

      if (!o.shopOrderId && o.checkoutSent) {
        // Direct checkout with a lost response: may be paid, no id to look up
        await record(orderId, 'check-manually', keep);
        await say(`⚠️ CM ${orderId}: label may be paid but can't be looked up — check Portokasse/history, buy manually only if missing.\n\`\`\`\n${o.recipientAddress}\n\`\`\``);
        continue;
      }
      if (!o.shopOrderId) {
        // No checkout sent
        if (o.attempts < 1) {
          await record(orderId, 'retry', { ...keep, attempts: o.attempts + 1 });
          await say(`🔁 CM ${orderId}: nothing was sent to DHL, buying on the next poll.`);
        } else {
          await record(orderId, 'failed', { ...keep, error: 'stopped before checkout twice' });
          await say(`🛑 CM ${orderId}: stopped before checkout twice, nothing bought. Buy it manually.`);
        }
        continue;
      }
      const r = await recoverLabel(ctx, { shopOrderId: o.shopOrderId, recipientAddress: o.recipientAddress, productCode: o.productCode, productName: o.productName, meta: { cmOrderId: orderId } })
        .catch(err => ({ success: false, error: err.message }));

      if (r.success) {
        await finishBought(orderId, keep, r, `${o.productName} (recovered, order ${o.shopOrderId})`);
      } else if (r.notFound && o.status !== 'bought-unstored') {
        if (o.attempts < 1) {
          await record(orderId, 'retry', { ...keep, attempts: o.attempts + 1 });
          await say(`🔁 CM ${orderId}: not bought at DHL (order ${o.shopOrderId}), retrying on the next poll.`);
        } else {
          await record(orderId, 'failed', { ...keep, error: 'not bought after retry' });
          await say(`🛑 CM ${orderId}: not bought at DHL after a retry (order ${o.shopOrderId}). Buy it manually.\n\`\`\`\n${o.recipientAddress}\n\`\`\``);
        }
      } else if (!o.recoveryNotified) {
        o.recoveryNotified = true;
        await saveState();
        await say(`⚠️ CM ${orderId}: lookup of order ${o.shopOrderId} failed — ${[r.error, r.details].filter(Boolean).join(' — ')}. Retrying each poll.`);
      }
    }
  }

  /** Not from Cardmarket: noticed once per message, never recorded under the order ID (a fake must not block the real order). */
  async function rejectForeign(msg, folder, orderId, reason) {
    const key = msg.envelope?.messageId || `${folder}:${msg.uid}`;
    if (state.foreign[key]) return;
    state.foreign[key] = { at: new Date().toISOString(), orderId, reason };
    await saveState();
    await notify(`🚫 CM ${orderId}: mail ignored — ${reason}. Not from Cardmarket?`);
  }

  async function pollOnce() {
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
      if (!cfg.dryRun) await recoverPending();
      const startedAt = new Date(state.startedAt);
      // 7-day lookback bounds the search as the archive grows; covers up to a week of downtime
      const since = new Date(Math.max(startedAt, Date.now() - 7 * 86_400_000));
      for (const folder of cfg.folders) {
        if (stopping) break;
        const lock = await client.getMailboxLock(folder, { readOnly: !cfg.archiveFolder || folder === cfg.archiveFolder });
        try {
          const uids = await client.search(
            { since, or: [{ subject: 'Bitte versenden' }, { subject: 'Please ship' }] },
            { uid: true }
          ) || [];
          const candidates = [];
          const foreign = [];
          const genuine = [];
          // Chunked: servers cap command length (4096 bytes seen)
          for (let i = 0; i < uids.length; i += 200) {
            const query = { envelope: true, internalDate: true, headers: ['authentication-results'] };
            for await (const msg of client.fetch(uids.slice(i, i + 200), query, { uid: true })) {
              const { orderId, buyer } = matchSubject(msg.envelope?.subject) || {};
              if (!orderId || msg.internalDate < startedAt) continue;
              // Sender before dedupe: a fake reusing a known order ID still gets its notice
              const problem = senderProblem(msg.envelope.from?.[0]?.address, topHeader(msg.headers, 'authentication-results'));
              if (problem) { foreign.push({ msg, orderId, problem }); continue; }
              genuine.push({ uid: msg.uid, orderId });
              const known = state.orders[orderId];
              if (!known || WAITING.has(known.status)) candidates.push({ uid: msg.uid, orderId, buyer });
            }
          }
          for (const { msg, orderId, problem } of foreign) await rejectForeign(msg, folder, orderId, problem);
          for (const { uid, orderId, buyer } of candidates) {
            if (stopping) break;
            const known = state.orders[orderId];
            if (known && !WAITING.has(known.status)) continue; // same order mailed twice in one poll
            const win = printWindowState(cfg.windows);
            if (!win.open) {
              // Mail stays in the mailbox; the first poll inside the window processes it
              if (!known) {
                await record(orderId, 'queued', { buyer, opens: win.opens });
                await notify(`${buyer}\n⏰ CM ${orderId}: queued until ${win.opens}`);
              }
              continue;
            }
            const msg = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!msg?.source) continue; // moved to another folder since the search; found there next poll
            logger.info(`[CM] Processing order ${orderId} (${folder})`);
            try {
              const mail = await simpleParser(msg.source);
              await processMail(orderId, buyer, mail.text, tables);
            } catch (err) {
              // Recorded so one broken mail can't block every later order
              logger.error(`[CM] Order ${orderId} failed:`, err);
              const prev = state.orders[orderId];
              if (!prev || ['processing', 'retry', 'queued'].includes(prev.status)) {
                // Purchase fields kept: an error mid-purchase may have been paid (cap, lookup by shopOrderId)
                const { status: _s, at: _a, ...keep } = prev || {};
                await record(orderId, 'error', { ...keep, error: err.message });
              }
              await notify(`${buyer}\n🛑 CM ${orderId}: error — ${err.message}. Do it manually, no retry.`);
            }
          }
          await archiveMails(client, folder, genuine.filter(m => ARCHIVE.has(state.orders[m.orderId]?.status)).map(m => m.uid), cfg.archiveFolder);
        } finally {
          lock.release();
        }
      }
      // Paid DHL Paket carts: payment is manual, so handled in dry run too
      if (paket && !stopping) await paket.pollMails(client, cfg.folders, cfg.archiveFolder).catch(err => logger.error('[Paket] Mail poll failed:', err.message));
      await client.logout();
      if (failing) await notify('✅ CM mail polling recovered.');
      failing = false;
    } catch (err) {
      logger.error('[CM] Poll failed:', err.message);
      if (!failing) await notify(`⚠️ CM mail polling failing: ${err.message}`);
      failing = true;
      client.close();
    }
  }

  let lastSummary;
  let refusedFor;
  /** Re-reads settings; a change after startup is posted to Discord (arming, caps and top-up move money). */
  async function refreshSettings() {
    applySettings();
    const problems = cfg.dryRun ? [] : liveConfigProblems();
    if (problems.length) {
      cfg.dryRun = true;
      const missing = problems.join(', ');
      if (refusedFor !== missing) await notify(`🛑 CM intake: LIVE refused, running DRY RUN — missing ${missing}`);
      refusedFor = missing;
    } else {
      refusedFor = undefined;
    }
    const summary = `${cfg.dryRun ? 'DRY RUN' : 'LIVE'}, max ${cfg.dailyCap} labels/day, print window weekday ${showWindow(cfg.windows.weekday)} / weekend ${showWindow(cfg.windows.weekend)}, auto top-up ${cfg.topupCents ? `${eur(cfg.topupCents)} € when balance < label, max ${eur(cfg.topupDailyMaxCents)} €/day` : 'off'}`;
    if (summary === lastSummary) return;
    logger.info(`[CM] ${summary}`);
    if (lastSummary) await notify(`⚙️ CM intake settings changed: ${summary}`);
    lastSummary = summary;
  }

  function poll() {
    if (running || stopping) return;
    running = true;
    current = refreshSettings().then(pollOnce)
      .catch(err => logger.error('[CM] Poll failed:', err.message))
      .finally(() => { running = false; });
  }

  loadState()
    .then(() => {
      logger.info(`[CM] Email intake on, polling ${cfg.folders.join(' + ')} every ${cfg.pollMs / 1000}s, since ${state.startedAt}`);
      poll();
      timer = setInterval(poll, cfg.pollMs);
    })
    .catch(err => logger.error('[CM] Intake start failed:', err.message));
}
