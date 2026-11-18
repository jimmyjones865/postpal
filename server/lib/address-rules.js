// Deutsche Post address rules, shared by the server and the frontend (src/lib/addressValidation.ts).
// Plain ESM without Node imports so Vite can bundle it.

// No official charset found; this allowlist is empirical.
const ALLOWED = /^[a-zA-ZäöüßÄÖÜáàÁÀéèÉÈíìÍÌóòÓÒúùÚÙâÂêÊîÎôÔûÛøØ0-9\s,.\-&/()'`+]$/;

// Letters NFD can't reduce to ASCII, plus typographic punctuation
const REPLACEMENTS = {
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th',
  'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H',
  '’': "'", '‘': "'", '´': "'", 'ʼ': "'", '“': '', '”': '', '„': '', '"': '',
  '–': '-', '—': '-', '‐': '-', '\u00a0': ' ',
  '°': '.', 'º': '.', 'ª': '.',
};

export const MAX_LINE_LENGTH = 50;
const FIELD_LIMITS = { name: 50, additionalName: 40, addressLine1: 50, addressLine2: 50, city: 50 };
// DHL Parcel DE Private Shipping v1 Address schema; addressLine1 is checked as street + streetNumber
const PAKET_LIMITS = { name: 35, additionalName: 35, addressLine2: 35, city: 35, postalCode: 17 };

// "Zimmerstr. 23a" → { street: "Zimmerstr.", streetNumber: "23a" }
export function splitStreet(line = '') {
  const m = line.trim().match(/^(.*?\D)\s*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/);
  return m ? { street: m[1].trim(), streetNumber: m[2].replace(/\s+/g, '') } : { street: line.trim(), streetNumber: '' };
}

/** Replaces or strips characters outside the allowlist; anything still invalid is kept for validation to catch. */
export function sanitizeText(text) {
  let out = '';
  for (const ch of text) {
    if (ch in REPLACEMENTS) { out += REPLACEMENTS[ch]; continue; }
    if (ALLOWED.test(ch)) { out += ch; continue; }
    const stripped = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += stripped && [...stripped].every(c => ALLOWED.test(c)) ? stripped : ch;
  }
  return out;
}

/** Characters that remain invalid after sanitizing. */
export function invalidChars(text) {
  return [...new Set([...sanitizeText(text)].filter(c => !ALLOWED.test(c)))];
}

/**
 * Sanitizes a DHL receiver object. Internetmarke prints additionalName above name, so when both exist they are
 * swapped to keep the input's first line (the person) on top. paket: no swap, DHL Paket length limits.
 * Returns { receiver, errors }; errors non-empty → do not buy.
 */
export function prepareReceiver(input, { paket = false } = {}) {
  const receiver = {};
  for (const [key, value] of Object.entries(input)) {
    receiver[key] = typeof value === 'string' ? sanitizeText(value).trim() : value;
  }
  if (!paket && receiver.name && receiver.additionalName) {
    [receiver.name, receiver.additionalName] = [receiver.additionalName, receiver.name];
  }

  const errors = [];
  const limits = paket ? PAKET_LIMITS : FIELD_LIMITS;
  for (const key of new Set([...Object.keys(FIELD_LIMITS), ...Object.keys(limits)])) {
    const value = receiver[key];
    const max = limits[key];
    if (!value) continue;
    if (max && value.length > max) errors.push(`${key} has ${value.length} chars (max ${max})`);
    const bad = invalidChars(value);
    if (bad.length) errors.push(`${key} contains invalid characters: ${bad.join(' ')}`);
  }
  if (paket && receiver.addressLine1) {
    const { street, streetNumber } = splitStreet(receiver.addressLine1);
    if (street.length > 35) errors.push(`street has ${street.length} chars (max 35)`);
    if (streetNumber.length > 10) errors.push(`house number has ${streetNumber.length} chars (max 10)`);
  }
  for (const key of ['name', 'addressLine1', 'postalCode', 'city', 'country']) {
    if (!receiver[key]) errors.push(`${key} missing`);
  }
  return { receiver, errors };
}
