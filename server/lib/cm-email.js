// Cardmarket "please ship" email → order data. Two templates (EN/DE), same layout.

import { parseAddress } from './european-address-parser.js';
import { prepareReceiver, pakLocker } from './address-rules.js';
import { getCountryCode, EU_ISO3 } from './country-codes.js';

const SUBJECT_PATTERNS = [
  /^Bestellung (\d+) für (.+): Bitte versenden$/,
  /^Shipment (\d+) for (.+): Please ship$/
];

/** { orderId, buyer } from the subject, or null for any other mail. */
export function matchSubject(subject) {
  for (const re of SUBJECT_PATTERNS) {
    const m = (subject || '').trim().match(re);
    if (m) return { orderId: m[1], buyer: m[2] };
  }
  return null;
}

// German cancel subject never seen yet: "wurde storniert" is a guess
const NOTICE_PATTERNS = [
  [/^Shipment (\d+) for (.+): SOLD$/, 'sold'],
  [/^Bestellung (\d+) für (.+): Verkauf$/, 'sold'],
  [/^Shipment (\d+) for (.+?) has been cancelled: (.+)$/, 'cancelled'],
  [/^Bestellung (\d+) für (.+?) wurde storniert: (.+)$/, 'cancelled']
];

/** SOLD (unpaid) or cancelled mail → { kind, orderId, buyer, reason }, else null. */
export function matchNotice(subject) {
  for (const [re, kind] of NOTICE_PATTERNS) {
    const m = (subject || '').trim().match(re);
    if (m) return { kind, orderId: m[1], buyer: m[2], reason: m[3]?.replace(/\.$/, '') ?? null };
  }
  return null;
}

const CM_DOMAIN =/^(?:[\w-]+\.)*cardmarket\.com$/i;

/** First (= added by the receiving server) instance of a header from a raw header block, unfolded. */
export function topHeader(raw, name) {
  const text = (raw?.toString() || '').replace(/\r?\n[ \t]+/g, ' ');
  return text.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'im'))?.[1] ?? null;
}

/** Authentication-Results shows DKIM pass for domainRe (a regex source) or a subdomain of it. */
export function dkimPasses(authResults, domainRe) {
  return new RegExp(`\\bdkim=pass\\b[^;]*\\bheader\\.d=(?:[\\w-]+\\.)*${domainRe}(?=[\\s;]|$)`, 'i').test(authResults);
}

/**
 * Null if the mail is from Cardmarket, else the reason. Domain, not full address: CM may change the sender.
 * DKIM is checked only when the receiving server added Authentication-Results.
 */
export function senderProblem(fromAddress, authResults) {
  const domain = (fromAddress || '').split('@').pop();
  if (!fromAddress?.includes('@') || !CM_DOMAIN.test(domain)) return `sender ${fromAddress || '(none)'} is not cardmarket.com`;
  if (authResults && !dkimPasses(authResults, 'cardmarket\\.com')) {
    return 'no DKIM pass for cardmarket.com';
  }
  return null;
}

// CM language names, EN + DE mails: a "..."-cut last segment counts only if it is a whole one
const LANGUAGES = new Set([
  'English', 'French', 'German', 'Spanish', 'Italian', 'Simplified Chinese', 'Japanese', 'Portuguese', 'Russian', 'Korean', 'Traditional Chinese',
  'Englisch', 'Französisch', 'Deutsch', 'Spanisch', 'Italienisch', 'Chinesisch (vereinfacht)', 'Japanisch', 'Portugiesisch', 'Russisch', 'Koreanisch', 'Chinesisch (traditionell)'
]);

/**
 * "Name (Set) - R - English - …", cut by CM at ~70 chars with "...". Lost parts are null;
 * a cut set keeps its prefix ("Secret La"), so callers can still prefix-match it.
 */
export function parseItem(raw) {
  const cut = /\.\.\.$/.test(raw);
  const core = raw.replace(/ ?-? ?\.\.\.$/, '');
  const r = core.match(/^(.*?) - ([A-Z]{1,3})(?: - (.*))?$/);
  const title = r ? r[1] : core;
  const rest = r?.[3]?.split(' - ') ?? [];
  const lang = rest[0] && (rest.length > 1 || !cut || LANGUAGES.has(rest[0])) ? rest[0] : null;
  const t = title.match(/^(.*) \(([^()]*)\)$/) || (cut && !r ? title.match(/^(.*) \(([^()]*)$/) : null);
  return { name: (t ? t[1] : title).trim(), set: t?.[2] || null, rarity: r?.[2] ?? null, lang };
}

/**
 * Extracts order ID, address lines, shipping cost, items, item count (sum of quantities), total, commission and net from the plain-text body.
 * Returns { orderId, addressLines, costEur, items, itemCount, totalEur, commissionEur, netEur } with null for anything not found (items: []).
 * Item: { raw, qty, name, set, rarity, lang, price } (price per unit, as in the mail: "1,72").
 */
export function parseBody(text) {
  const body = (text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).join('\n');
  const amount = label => body.match(new RegExp(`^(?:${label}):? +(\\d{1,3}(?:\\.\\d{3})*,\\d{2}) EUR$`, 'm'))?.[1] ?? null;

  const orderId = body.match(/^(?:Shipment|Bestellnummer:) (\d+)$/m)?.[1] ?? null;
  const block = body.match(/^Status: .*\n([\s\S]*?)\n(?:Tracking|Sendungsverfolgung):/m)?.[1];
  const addressLines = block ? block.split('\n').filter(Boolean) : null;
  const cost = body.match(/^(?:Shipping|Versandkosten)\s+(\d+),(\d{2}) EUR$/m);
  const costEur = cost ? `${cost[1]}.${cost[2]}` : null;
  // Columns are space-padded
  const items = [...body.matchAll(/^(\d+)x (.+?) +(\d{1,3}(?:\.\d{3})*,\d{2}) EUR$/gm)].map(m => ({
    raw: m[2],
    qty: Number(m[1]),
    ...parseItem(m[2]),
    price: m[3]
  }));
  const itemCount = items.length ? items.reduce((sum, i) => sum + i.qty, 0) : null;

  return {
    orderId,
    addressLines: addressLines?.length ? addressLines : null,
    costEur,
    items,
    itemCount,
    totalEur: amount('Total|Gesamtbetrag'),
    commissionEur: amount('Commission|Gebühren'),
    netEur: amount('Net sale price|Auszahlungsbetrag')
  };
}

const MAX_ITEM_LINES = 5;

/** Item lines as a Discord code block (first 5, then "+N more"), '' if none parsed. */
export function itemBlock(items) {
  if (!items?.length) return '';
  const lines = items.slice(0, MAX_ITEM_LINES).map(i => `${i.qty}× ${(i.set ? `${i.name} (${i.set})` : i.name).replaceAll('`', "'")} ${i.price}`);
  if (items.length > MAX_ITEM_LINES) lines.push(`… +${items.length - MAX_ITEM_LINES} more`);
  return `\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Checks one parsed email against all no-buy rules.
 * Returns { ok: true, product, priceCents, receiver, recipientAddress } (letter), { ok: true, paket: { productId, insurance }, receiver, recipientAddress }
 * (DHL Paket: no cap, paid by hand) or { ok: false, reason }.
 */
export function decide({ subjectOrderId, orderId, addressLines, costEur }, { costTable, products, boughtToday, dailyCap }) {
  if (!orderId) return { ok: false, reason: 'order ID not found in body' };
  if (orderId !== subjectOrderId) return { ok: false, reason: `subject order ${subjectOrderId} ≠ body order ${orderId}` };
  if (!addressLines) return { ok: false, reason: 'address block not found' };
  if (!costEur) return { ok: false, reason: 'shipping cost not found' };

  // Paket entries are keyed per destination: the same CM cost can mean different products by country
  const letterCode = typeof costTable[costEur] === 'string' ? costTable[costEur] : undefined;
  const paketTable = costTable.paket || {};
  if (!letterCode && !Object.values(paketTable).some(t => t[costEur])) {
    return { ok: false, reason: `unknown shipping cost ${costEur.replace('.', ',')} EUR` };
  }

  const parsed = parseAddress(addressLines.join('\n'));
  const country = getCountryCode(parsed.country);
  if (!country) return { ok: false, reason: `unknown country "${parsed.country}"` };

  const paketCode = (paketTable[country] ?? (EU_ISO3.has(country) ? paketTable.EU : undefined))?.[costEur];
  let product, priceCents, paket;
  if (paketCode) {
    const [productId, insurance] = paketCode.split('.');
    paket = { productId, insurance: insurance || null };
  } else {
    if (!letterCode) return { ok: false, reason: `shipping cost ${costEur.replace('.', ',')} EUR has no Paket product for ${country}` };
    product = products.find(p => p.code === letterCode);
    if (!product) return { ok: false, reason: `product ${letterCode} missing from products.json` };
    priceCents = Math.round(product.cost * 100);
    if (boughtToday >= dailyCap) return { ok: false, reason: `daily cap of ${dailyCap} labels reached` };
    if (product.domestic !== (country === 'DEU')) {
      return { ok: false, reason: `${product.name} does not fit destination ${country}` };
    }
  }

  // Email path only (UI can override): catches a house number typed onto the postcode line
  if (!/\p{L}/u.test(parsed.city)) return { ok: false, reason: `city "${parsed.city}" has no letters` };
  if (!/\d/.test(parsed.street)) return { ok: false, reason: `street "${parsed.street}" has no house number` };

  // Letter: buyLabel prepares (sanitize + swap) again; checked here too so dry runs report bad addresses.
  // Paket: the prepared receiver goes to DHL as is.
  const receiver = {
    name: parsed.name,
    additionalName: parsed.additionalName || undefined,
    addressLine1: parsed.street,
    addressLine2: parsed.addressLine2 || undefined,
    postalCode: parsed.zip,
    city: parsed.city,
    country
  };
  // Deutsche Post doesn't deliver letters to Packstation / Postfiliale
  const locker = !paket && pakLocker(receiver);
  if (locker) return { ok: false, reason: `letter to ${locker.kind ?? 'Packstation/Postfiliale'} — buy manually or ship as Paket` };

  const prepared = prepareReceiver(receiver, { paket: !!paket });
  if (prepared.errors.length) return { ok: false, reason: prepared.errors.join('; ') };

  return { ok: true, product, priceCents, paket, receiver: paket ? prepared.receiver : receiver, recipientAddress: addressLines.join('\n') };
}
