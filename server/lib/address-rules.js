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
 * swapped to keep the input's first line (the person) on top. paket: no swap, no letter length limits.
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
  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    const value = receiver[key];
    if (!value) continue;
    if (!paket && value.length > max) errors.push(`${key} has ${value.length} chars (max ${max})`);
    const bad = invalidChars(value);
    if (bad.length) errors.push(`${key} contains invalid characters: ${bad.join(' ')}`);
  }
  for (const key of ['name', 'addressLine1', 'postalCode', 'city', 'country']) {
    if (!receiver[key]) errors.push(`${key} missing`);
  }
  return { receiver, errors };
}
