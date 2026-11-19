// Sales data → turbostats (SALES_URL). Fire-and-forget: never throws, no retry (backfill script heals gaps).

import { logger } from './logger.js';
import { parseAddress } from './european-address-parser.js';
import { getCountryCode } from './country-codes.js';

/** "1.314,18" → 1314.18 */
const mailEur = s => (s == null ? null : Number(s.replaceAll('.', '').replace(',', '.')));

function countryOf(addressLines) {
  if (!addressLines) return null;
  try {
    return getCountryCode(parseAddress(addressLines.join('\n')).country) || null;
  } catch {
    return null;
  }
}

/** parseBody result → turbostats sale. No name/address: country only. */
export function saleFromMail(shipmentId, buyer, parsed, mailDate) {
  const date = mailDate ? new Date(mailDate) : null;
  return {
    shipmentId,
    buyer: buyer || null,
    mailDate: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    country: countryOf(parsed.addressLines),
    totalEur: mailEur(parsed.totalEur),
    commissionEur: mailEur(parsed.commissionEur),
    netEur: mailEur(parsed.netEur),
    shippingEur: parsed.costEur == null ? null : Number(parsed.costEur),
    items: (parsed.items || []).map(({ raw, qty, name, set, rarity, lang, price }) => ({ raw, qty, name, set, rarity, lang, priceEur: mailEur(price) }))
  };
}

/** → true if turbostats accepted it. */
async function post(urlPath, body) {
  const base = process.env.SALES_URL;
  if (!base) return false;
  try {
    const res = await fetch(new URL(urlPath, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000)
    });
    if (res.ok) return true;
    logger.warn('[Sales] Push failed:', urlPath, res.status, await res.text());
  } catch (err) {
    logger.warn('[Sales] Push error:', urlPath, err.message);
  }
  return false;
}

export const pushSale = sale => post('/api/sales', sale);

/** Never throws, even on an odd parse: the caller moves money. */
export function pushMailSale(shipmentId, buyer, parsed, mailDate) {
  if (!process.env.SALES_URL) return Promise.resolve(false);
  try {
    return pushSale(saleFromMail(shipmentId, buyer, parsed, mailDate));
  } catch (err) {
    logger.warn('[Sales] Sale build error:', shipmentId, err.message);
    return Promise.resolve(false);
  }
}

export function pushPostage(shipmentId, postageEur, product) {
  if (!shipmentId || typeof postageEur !== 'number') return Promise.resolve(false);
  return post(`/api/sales/${encodeURIComponent(shipmentId)}/postage`, { postageEur, product: product || null });
}
