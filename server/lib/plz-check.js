import { logger } from './logger.js';

const norm = s => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z]/g, '');

/**
 * German PLZ vs city via OpenPLZ (open data, no key). → warning text | null. Never throws; lookup failure = null.
 * Loose match ("Frankfurt" ↔ "Frankfurt am Main", "Berlin-Mitte" ↔ "Berlin"); only clear mismatches warn.
 */
export async function plzCityWarning({ country, postalCode, city }, fetchFn = fetch) {
  if (country !== 'DEU' || !/^\d{5}$/.test(postalCode ?? '') || !city) return null;
  try {
    const res = await fetchFn(`https://openplzapi.org/de/Localities?postalCode=${postalCode}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const names = [...new Set((await res.json()).map(l => l.name))];
    if (!names.length) return `PLZ ${postalCode} does not exist`;
    const c = norm(city);
    if (names.some(n => { const m = norm(n); return c.includes(m) || m.includes(c); })) return null;
    return `PLZ ${postalCode} → ${names.join(' / ')}, buyer wrote "${city}"`;
  } catch (err) {
    logger.warn('[PLZ check]', postalCode, err.message);
    return null;
  }
}
