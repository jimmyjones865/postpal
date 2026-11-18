// Quiet hours for the email path: outside the window, orders wait (no purchase, no print). Times are Europe/Berlin.

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WEEKEND = new Set(['Sat', 'Sun']);

/** "07:00-21:00" or "7-21" → { start, end } in minutes; empty → null (always open). Throws on bad input. */
export function parseWindow(text) {
  if (!text?.trim()) return null;
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`bad print window "${text}" (want HH:MM-HH:MM)`);
  const start = +m[1] * 60 + +(m[2] || 0);
  const end = +m[3] * 60 + +(m[4] || 0);
  if (start >= end || end > 24 * 60) throw new Error(`bad print window "${text}" (start must be before end, same day)`);
  return { start, end };
}

const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function berlinParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return { weekday: p.weekday, minutes: +p.hour * 60 + +p.minute };
}

/**
 * windows = { weekday, weekend } as returned by parseWindow (null = always open).
 * Returns { open: true } or { open: false, opens: 'Sat 09:00' }.
 */
export function printWindowState(windows, date = new Date()) {
  const pick = wd => (WEEKEND.has(wd) ? windows.weekend : windows.weekday);
  const now = berlinParts(date);
  const today = pick(now.weekday);
  if (!today || (now.minutes >= today.start && now.minutes < today.end)) return { open: true };
  if (now.minutes < today.start) return { open: false, opens: `${now.weekday} ${hhmm(today.start)}` };
  // Every day has a window (or none = open from 00:00), so the next opening is tomorrow
  // Aim at ~01:00 tomorrow, not +24h: a 23h DST day would skip a weekday
  const wd = berlinParts(new Date(date.getTime() + (24 * 60 - now.minutes + 60) * 60_000)).weekday;
  const w = pick(wd);
  return { open: false, opens: `${wd} ${hhmm(w ? w.start : 0)}` };
}

/** Window for logs: '07:00-21:00' or '24h'. */
export const showWindow = w => (w ? `${hhmm(w.start)}-${hhmm(w.end)}` : '24h');
