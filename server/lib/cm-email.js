// Cardmarket "please ship" email → order data. Two templates (EN/DE), same layout.

import { parseAddress } from './european-address-parser.js';
import { prepareReceiver } from './address-rules.js';
import { getCountryCode } from './country-codes.js';

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

/**
 * Extracts order ID, address lines and shipping cost from the plain-text body.
 * Returns { orderId, addressLines, costEur } with null for anything not found.
 */
export function parseBody(text) {
  const body = (text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).join('\n');

  const orderId = body.match(/^(?:Shipment|Bestellnummer:) (\d+)$/m)?.[1] ?? null;
  const block = body.match(/^Status: .*\n([\s\S]*?)\n(?:Tracking|Sendungsverfolgung):/m)?.[1];
  const addressLines = block ? block.split('\n').filter(Boolean) : null;
  const cost = body.match(/^(?:Shipping|Versandkosten)\s+(\d+),(\d{2}) EUR$/m);
  const costEur = cost ? `${cost[1]}.${cost[2]}` : null;

  return { orderId, addressLines: addressLines?.length ? addressLines : null, costEur };
}

/**
 * Checks one parsed email against all no-buy rules.
 * Returns { ok: true, product, receiver, recipientAddress } or { ok: false, reason }.
 */
export function decide({ subjectOrderId, orderId, addressLines, costEur }, { costTable, products, boughtToday, maxPriceCents, dailyCap }) {
  if (!orderId) return { ok: false, reason: 'order ID not found in body' };
  if (orderId !== subjectOrderId) return { ok: false, reason: `subject order ${subjectOrderId} ≠ body order ${orderId}` };
  if (!addressLines) return { ok: false, reason: 'address block not found' };
  if (!costEur) return { ok: false, reason: 'shipping cost not found' };

  const code = costTable[costEur];
  if (!code) return { ok: false, reason: `unknown shipping cost ${costEur.replace('.', ',')} EUR` };
  const product = products.find(p => p.code === code);
  if (!product) return { ok: false, reason: `product ${code} missing from products.json` };

  const priceCents = Math.round(product.cost * 100);
  if (priceCents > maxPriceCents) return { ok: false, reason: `${product.name} costs ${product.cost} € > max ${maxPriceCents / 100} €` };
  if (boughtToday >= dailyCap) return { ok: false, reason: `daily cap of ${dailyCap} labels reached` };

  const parsed = parseAddress(addressLines.join('\n'));
  const country = getCountryCode(parsed.country);
  if (!country) return { ok: false, reason: `unknown country "${parsed.country}"` };
  if (product.domestic !== (country === 'DEU')) {
    return { ok: false, reason: `${product.name} does not fit destination ${country}` };
  }

  // buyLabel prepares (sanitize + swap) again; checked here too so dry runs report bad addresses
  const receiver = {
    name: parsed.name,
    additionalName: parsed.additionalName || undefined,
    addressLine1: parsed.street,
    addressLine2: parsed.addressLine2 || undefined,
    postalCode: parsed.zip,
    city: parsed.city,
    country
  };
  const { errors } = prepareReceiver(receiver);
  if (errors.length) return { ok: false, reason: errors.join('; ') };

  return { ok: true, product, priceCents, receiver, recipientAddress: addressLines.join('\n') };
}
