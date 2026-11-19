// Pushes every Cardmarket "please ship" mail + stored postage to turbostats. Mailbox read-only; idempotent (turbostats upserts).
// docker exec postpal node scripts/backfill-sales.js [--dry-run]
// --dry-run: parse + stats only, nothing sent.

import fs from 'fs/promises';
import path from 'path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { matchSubject, parseBody, senderProblem, topHeader } from '../lib/cm-email.js';
import { saleFromMail, pushSale, pushPostage } from '../lib/sales.js';
import { envNum } from '../lib/config.js';

const dryRun = process.argv.includes('--dry-run');
const env = process.env;
if (!env.MAIL_SERVER || !env.MAIL_USERNAME || !env.MAIL_PASSWORD) throw new Error('MAIL_SERVER/MAIL_USERNAME/MAIL_PASSWORD not set');
if (!dryRun && !env.SALES_URL) throw new Error('SALES_URL not set');

const folders = (env.MAIL_FOLDER || 'INBOX,Archive').split(',').map(f => f.trim()).filter(Boolean);
const stats = { mails: 0, foreign: 0, orders: 0, sales: 0, salesFailed: 0, postage: 0, postageFailed: 0, postageByAddress: 0, postageUnmatched: 0, noCountry: 0, items: 0, cutLines: 0, setLost: 0, setCut: 0 };

const port = envNum('MAIL_PORT', 993);
const client = new ImapFlow({ host: env.MAIL_SERVER, port, secure: port === 993, auth: { user: env.MAIL_USERNAME, pass: env.MAIL_PASSWORD }, logger: false });
await client.connect();

// Pass 1: envelopes. Latest genuine mail per order wins (CM sends duplicates; mail moves INBOX → Archive).
const latest = new Map();
for (const folder of folders) {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const uids = await client.search({ or: [{ subject: 'Bitte versenden' }, { subject: 'Please ship' }] }, { uid: true }) || [];
    // Chunked: servers cap command length
    for (let i = 0; i < uids.length; i += 200) {
      const query = { envelope: true, internalDate: true, headers: ['authentication-results'] };
      for await (const msg of client.fetch(uids.slice(i, i + 200), query, { uid: true })) {
        const { orderId, buyer } = matchSubject(msg.envelope?.subject) || {};
        if (!orderId) continue;
        stats.mails++;
        if (senderProblem(msg.envelope.from?.[0]?.address, topHeader(msg.headers, 'authentication-results'))) { stats.foreign++; continue; }
        const prev = latest.get(orderId);
        if (!prev || msg.internalDate > prev.date) latest.set(orderId, { folder, uid: msg.uid, buyer, date: msg.internalDate });
      }
    }
  } finally {
    lock.release();
  }
}
stats.orders = latest.size;

// Labels without an order ID: matched by recipient address (local only, never sent)
const byAddress = new Map();
// Name line + postcode-like numbers: survives UI edits (country names translated, street fixes)
const addressKey = lines => [(lines[0] || '').toLowerCase().replace(/\s+/g, ' ').trim(), ...lines.slice(1).join(' ').match(/\b\d{4,6}\b/g) || []].join('|');

// Pass 2: bodies → parse → push
for (const folder of folders) {
  const picked = [...latest.entries()].filter(([, m]) => m.folder === folder);
  if (!picked.length) continue;
  const byUid = new Map(picked.map(([orderId, m]) => [m.uid, { orderId, ...m }]));
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const uids = [...byUid.keys()];
    for (let i = 0; i < uids.length; i += 50) {
      const batch = [];
      for await (const msg of client.fetch(uids.slice(i, i + 50), { source: true }, { uid: true })) batch.push(msg);
      for (const msg of batch) {
        const { orderId, buyer, date } = byUid.get(msg.uid);
        const mail = await simpleParser(msg.source);
        const parsed = parseBody(mail.text);
        const sale = saleFromMail(orderId, buyer, parsed, mail.date || date);
        if (parsed.addressLines) {
          const key = addressKey(parsed.addressLines);
          byAddress.set(key, [...(byAddress.get(key) || []), { orderId, at: Date.parse(sale.mailDate) }]);
        }
        if (!sale.country) stats.noCountry++;
        for (const it of sale.items) {
          stats.items++;
          if (!it.raw.endsWith('...')) continue;
          stats.cutLines++;
          if (!it.set) stats.setLost++;
          else if (!it.raw.includes(`(${it.set})`)) stats.setCut++;
        }
        if (dryRun) continue;
        if (await pushSale(sale)) stats.sales++;
        else stats.salesFailed++;
      }
    }
  } finally {
    lock.release();
  }
}
await client.logout();

// Postage: only what labels.json still holds (retention). Letter price = current products.json cost.
const MATCH_DAYS = 7;
/** Unique order with this exact address, mailed up to MATCH_DAYS before the label. */
function matchByAddress(l) {
  const t = Date.parse(l.createdAt);
  const hits = (byAddress.get(addressKey((l.recipientAddress || '').split('\n').map(x => x.trim()).filter(Boolean))) || []).filter(o => o.at <= t && t - o.at <= MATCH_DAYS * 86_400_000);
  return hits.length === 1 ? hits[0].orderId : null;
}
const labelsPath = path.join(env.PDF_STORAGE_PATH || './labels', 'labels.json');
const productsPath = path.join(env.STATIC_PATH || new URL('../public', import.meta.url).pathname, 'products.json');
const labels = JSON.parse(await fs.readFile(labelsPath, 'utf8').catch(() => '{"labels":[]}')).labels;
const products = JSON.parse(await fs.readFile(productsPath, 'utf8'));
for (const l of labels) {
  // Letter labels carry cmOrderId top-level, Paket labels in meta
  const linked = l.cmOrderId || l.meta?.cmOrderId;
  const id = linked || matchByAddress(l);
  if (!id) { stats.postageUnmatched++; continue; }
  if (!linked) stats.postageByAddress++;
  const price = l.provider === 'dhl-paket' ? l.price : products.find(p => p.code === l.productCode)?.cost;
  if (typeof price !== 'number') continue;
  if (dryRun) { stats.postage++; continue; }
  if (await pushPostage(id, price, l.productName)) stats.postage++;
  else stats.postageFailed++;
}

console.log(JSON.stringify({ dryRun, ...stats }));
if (stats.salesFailed || stats.postageFailed) process.exitCode = 1;
