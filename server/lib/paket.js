// DHL Paket orders: cart created on demand (/pay), paid by hand in DHL's checkout, detected via DHL's
// confirmation mail (cart id in the subject), then label stored + printed.

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import { topHeader } from './cm-email.js';
import { getCountryCode, EU_ISO3 } from './country-codes.js';
import { catalogPrice } from './dhl-private-api.js';
import { berlinDay } from './config.js';

const KEEP_MS = 14 * 86_400_000;
// Earlier cart opened this recently and not confirmed paid → ask before opening another
const REOPEN_GUARD_MS = 30 * 60_000;
const LOOKBACK_MS = 7 * 86_400_000;
const TAG_PATH = '/dhl-paid';
export const TRACK_URL = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=';
const SUBJECT_RE = /Online Frankierung\s+([A-Z0-9]{12})\s*$/;

const NAMES = { PAECKXS: 'DHL Päckchen XS', PAECKS: 'DHL Päckchen S', PAECK: 'DHL Päckchen M', PAK02: 'DHL Paket 2 kg', PAK05: 'DHL Paket 5 kg', PAK10: 'DHL Paket 10 kg', PAK20: 'DHL Paket 20 kg', PAK31: 'DHL Paket 31,5 kg' };
const INSURANCE_NAMES = { VERSI: 'versichert 2.500 €', HVERSI1000: 'versichert 1.000 €', HVERSI2000: 'versichert 2.000 €' };
export const pakProductName = (productId, insurance) => `${NAMES[productId] || productId}${insurance ? ` ${INSURANCE_NAMES[insurance] || insurance}` : ''}`;

// "Zimmerstr. 23a" → { street: "Zimmerstr.", streetNumber: "23a" }
export function splitStreet(line = '') {
  const m = line.trim().match(/^(.*?\D)\s*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/);
  return m ? { street: m[1].trim(), streetNumber: m[2].replace(/\s+/g, '') } : { street: line.trim(), streetNumber: '' };
}

// Postpal receiver/sender ({ name, additionalName, addressLine1, addressLine2, postalCode, city, country ISO3 }) → DHL Address
export function toPakAddress(a) {
  const { street, streetNumber } = splitStreet(a.addressLine1);
  return {
    name2: a.name,
    ...(a.additionalName ? { name3: a.additionalName } : {}),
    street,
    streetNumber,
    ...(a.addressLine2 ? { addressAddition1: a.addressLine2 } : {}),
    plz: a.postalCode,
    city: a.city,
    country: a.country,
  };
}

// Order id from a cart's notifyUrl tag; null if the cart wasn't made by postpal
export function tagOrderId(notifyUrl) {
  try {
    const u = new URL(notifyUrl);
    return u.pathname === TAG_PATH ? u.searchParams.get('order') : null;
  } catch {
    return null;
  }
}

// Top Authentication-Results present → must show DKIM pass for dhl.com
export function dhlSenderProblem(from = '', authResults) {
  if (!/@dhl\.com$/i.test(from)) return `sender ${from || '(none)'} is not @dhl.com`;
  if (authResults && !/dkim=pass[^;]*header\.d=dhl\.com/i.test(authResults)) return 'no DKIM pass for dhl.com';
  return null;
}

// print(labelId) → { success } | { skipped } | { success: false, error }
export function createPaketService({ storage, settings, pakClient, storagePath, publicUrl, confirmEmail, notify, print }) {
  const statePath = path.join(storagePath, 'paket-orders.json');
  let state;
  let queue = Promise.resolve();
  const serial = fn => (queue = queue.then(fn, fn));

  async function load() {
    if (state) return state;
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // Only confirmation mails from now on: old sandbox test mails sit in the mailbox
      state = { startedAt: new Date().toISOString(), orders: {}, carts: {} };
    }
    return state;
  }

  async function save() {
    const cutoff = Date.now() - KEEP_MS;
    for (const map of [state.orders, state.carts]) {
      for (const [id, o] of Object.entries(map)) if (Date.parse(o.at) < cutoff) delete map[id];
    }
    const tmp = `${statePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2));
    await fs.rename(tmp, statePath);
  }

  const payLink = id => `${publicUrl}/api/paket/pay/${encodeURIComponent(id)}`;

  /** { id, source, productId, productName, insurance, receiver, recipientAddress, buyer?, summary?, itemList? } */
  function addOrder(order) {
    return serial(async () => {
      await load();
      if (state.orders[order.id]) return { order: state.orders[order.id], existed: true };
      state.orders[order.id] = { ...order, status: 'awaiting-pay', carts: [], labels: [], at: new Date().toISOString() };
      await save();
      return { order: state.orders[order.id], payUrl: payLink(order.id) };
    });
  }

  async function listOrders() {
    await load();
    return Object.entries(state.orders).map(([id, o]) => ({ id, ...o, payUrl: payLink(id) }));
  }

  /** Current DHL price in EUR, null if unknown (catalog down / not offered). */
  async function quote(productId, insurance, country) {
    try {
      return catalogPrice(await pakClient.getCatalog(), productId, country, { insurance });
    } catch (err) {
      logger.warn('[Paket] Catalog failed:', err.message);
      return null;
    }
  }

  /**
   * Products offered to an ISO3 country for manual orders, catalog prices. DE + EU only (no customs data).
   * → [{ productId, insurance, name, price }] | null (catalog down)
   */
  async function products(country) {
    if (country !== 'DEU' && !EU_ISO3.has(country)) return [];
    let catalog;
    try {
      catalog = await pakClient.getCatalog();
    } catch (err) {
      logger.warn('[Paket] Catalog failed:', err.message);
      return null;
    }
    const list = [];
    for (const productId of Object.keys(NAMES)) {
      for (const insurance of [null, ...Object.keys(INSURANCE_NAMES)]) {
        const price = catalogPrice(catalog, productId, country, { insurance });
        if (price != null) list.push({ productId, insurance, name: pakProductName(productId, insurance), price });
      }
    }
    return list;
  }

  /** One ⏳ notice per Berlin day (from 09:00) listing orders still awaiting payment. */
  async function remindUnpaid(now = new Date()) {
    await load();
    const hour = Number(now.toLocaleString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }));
    const today = berlinDay(now);
    if (hour < 9 || state.remindedDay === today) return;
    const open = Object.entries(state.orders).filter(([, o]) => o.status === 'awaiting-pay' && berlinDay(o.at) !== today);
    state.remindedDay = today;
    await save();
    if (!open.length) return;
    const lines = open.map(([id, o]) => `• ${o.buyer ?? id}: ${o.productName} → ${payLink(id)}`);
    await notify(`⏳ ${open.length} Paket order${open.length === 1 ? '' : 's'} not paid yet:\n${lines.join('\n')}`);
  }

  function senderAddress() {
    const s = settings.get().senderAddress;
    return toPakAddress({ name: s.name, additionalName: s.company, addressLine1: s.street, postalCode: s.postalCode, city: s.city, country: getCountryCode(s.country) || 'DEU' });
  }

  /**
   * → { entryUrl } | { confirm: openedAt } | { done: true } | { error, status }
   * A cart can't be looked up before it's paid, so an unconfirmed earlier cart only triggers a confirm step.
   */
  function startPayment(id, { force = false } = {}) {
    return serial(async () => {
      await load();
      const o = state.orders[id];
      if (!o) return { error: 'Unknown order', status: 404 };
      if (o.status === 'done') return { done: true };
      const last = o.carts.at(-1);
      if (last && !force && Date.now() - Date.parse(last.at) < REOPEN_GUARD_MS) return { confirm: last.at };
      if (!confirmEmail) return { error: 'DHL_PAKET_EMAIL not set (confirmation mail must reach the intake mailbox)', status: 500 };
      const n = o.carts.length + 1;
      const notifyUrl = `${publicUrl}${TAG_PATH}?order=${encodeURIComponent(id)}&cart=${n}`;
      const { entryUrl } = await pakClient.createCart({
        productId: o.productId, insurance: o.insurance, sender: senderAddress(), receiver: toPakAddress(o.receiver), email: confirmEmail, notifyUrl,
      });
      o.carts.push({ n, at: new Date().toISOString() });
      await save();
      return { entryUrl };
    });
  }

  /** Paid cart → label stored + printed. Idempotent per cart id. Returns a short result for the manual route. */
  function handlePaidCart(cartId, { source = 'mail' } = {}) {
    return serial(async () => {
      await load();
      const known = state.carts[cartId];
      if (known && known.status !== 'error') return { status: known.status, orderId: known.orderId };
      const mark = async (status, extra = {}) => {
        state.carts[cartId] = { ...state.carts[cartId], status, at: state.carts[cartId]?.at || new Date().toISOString(), ...extra };
        await save();
        return { status, ...extra };
      };

      let cart;
      try {
        cart = await pakClient.getCart(cartId);
      } catch (err) {
        const first = !known;
        const r = await mark('error', { error: err.message });
        if (first) await notify(`⚠️ Paket cart ${cartId}: lookup failed — ${err.message}. Retrying each poll.`);
        return r;
      }
      if (!cart) return mark('ignored', { reason: 'unknown at DHL (other environment?)' });
      if (cart.state !== 'PAYED') {
        // Mail only comes after payment; a manual paste may be early → don't remember it
        if (source === 'manual') return { status: 'not-paid', state: cart.state };
        return mark('error', { error: `state ${cart.state}` });
      }
      const orderId = tagOrderId(cart.notifyUrl);
      const o = orderId && state.orders[orderId];
      if (!o) {
        // Untagged = bought outside postpal (DHL web shop): expected, log only. Tagged but unknown = postpal's, so warn.
        if (orderId) await notify(`⚠️ Paket cart ${cartId}: paid, made by postpal but order ${orderId} unknown — label not fetched.`);
        else logger.info(`[Paket] Cart ${cartId} paid outside postpal, ignored`);
        return mark('ignored', { reason: 'no postpal tag', orderId });
      }

      const second = o.labels.length > 0;
      const stored = [];
      try {
        for (const item of cart.items.filter(i => i.state === 'PAYED' && i.pakId)) {
          if (o.labels.some(l => l.pakId === item.pakId)) continue;
          const pdf = await pakClient.getLabel(item.pakId, 'MOPS');
          const label = await storage.saveLabel(pdf, {
            provider: 'dhl-paket', productCode: item.productId, productName: o.productName, recipientAddress: o.recipientAddress,
            trackId: item.shipmentNumber, pakId: item.pakId, cartId, price: item.price, meta: { paketOrderId: orderId, cmOrderId: o.cmOrderId },
          });
          o.labels.push({ labelId: label.id, pakId: item.pakId, shipmentNumber: item.shipmentNumber, cartId });
          stored.push({ label, item });
          await save();
        }
      } catch (err) {
        const first = !known;
        const r = await mark('error', { error: err.message, orderId });
        if (first) await notify(`⚠️ Paket ${orderId}: paid (cart ${cartId}) but label fetch/store failed — ${err.message}. Retrying each poll.`);
        return r;
      }
      o.status = 'done';
      await save();

      for (const { label, item } of stored) {
        const p = await print(label.id).catch(err => ({ success: false, error: err.message }));
        const printNote = p.skipped ? 'not printed (direct print off)' : p.success ? 'printed' : `print failed (${p.error}) — reprint from history`;
        const warn = second ? '\n⚠️ Another paid cart for this order — cancel one in DHL\'s checkout ("Versandmarke stornieren") if it was a double payment.' : '';
        const address = o.recipientAddress ? `\n\`\`\`\n${o.recipientAddress}\n\`\`\`` : '';
        await notify(`${o.summary ?? o.buyer ?? orderId}\n✅ Paket ${orderId}: ${o.productName} ${item.price.toFixed(2)} €, ${printNote}\n📦 ${item.shipmentNumber} [Tracking](<${TRACK_URL}${encodeURIComponent(item.shipmentNumber)}>)${address}${o.itemList ?? ''}${warn}`);
      }
      return mark('done', { orderId, labels: stored.map(s => s.label.id) });
    });
  }

  /** Called from the CM intake poll with its open IMAP client. */
  async function pollMails(client, folders) {
    await load();
    const since = new Date(Math.max(Date.parse(state.startedAt), Date.now() - LOOKBACK_MS));
    const found = [];
    for (const folder of folders) {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const uids = await client.search({ since, from: 'dhl.com', subject: 'Online Frankierung' }, { uid: true }) || [];
        for (let i = 0; i < uids.length; i += 200) {
          const query = { envelope: true, internalDate: true, headers: ['authentication-results'] };
          for await (const msg of client.fetch(uids.slice(i, i + 200), query, { uid: true })) {
            const cartId = msg.envelope?.subject?.match(SUBJECT_RE)?.[1];
            if (!cartId || msg.internalDate < since) continue;
            const known = state.carts[cartId];
            if (known && known.status !== 'error') continue;
            const problem = dhlSenderProblem(msg.envelope.from?.[0]?.address, topHeader(msg.headers, 'authentication-results'));
            if (problem) {
              logger.warn(`[Paket] Mail for cart ${cartId} ignored: ${problem}`);
              continue;
            }
            found.push(cartId);
          }
        }
      } finally {
        lock.release();
      }
    }
    for (const cartId of new Set(found)) {
      logger.info(`[Paket] Confirmation mail for cart ${cartId}`);
      await handlePaidCart(cartId);
    }
    await remindUnpaid();
  }

  return { addOrder, listOrders, startPayment, handlePaidCart, pollMails, payLink, quote, products, remindUnpaid };
}
