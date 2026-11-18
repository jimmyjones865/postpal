import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWindow, printWindowState } from '../lib/print-window.js';

const windows = { weekday: parseWindow('07:00-21:00'), weekend: parseWindow('9-19') };
const at = iso => printWindowState(windows, new Date(iso));

test('parseWindow', () => {
  assert.deepEqual(parseWindow('7-21'), { start: 420, end: 1260 });
  assert.deepEqual(parseWindow('07:30 - 21:00'), { start: 450, end: 1260 });
  assert.equal(parseWindow(''), null);
  assert.equal(parseWindow(undefined), null);
  assert.throws(() => parseWindow('21-7'), /start must be before end/);
  assert.throws(() => parseWindow('abc'), /HH:MM-HH:MM/);
});

test('printWindowState in Berlin time', () => {
  assert.deepEqual(at('2026-11-18T05:30:00Z'), { open: false, opens: 'Wed 07:00' }); // Wed 06:30 CET
  assert.deepEqual(at('2026-11-18T11:00:00Z'), { open: true });
  assert.deepEqual(at('2026-11-18T20:00:00Z'), { open: false, opens: 'Thu 07:00' }); // end is exclusive
  assert.deepEqual(at('2026-11-20T21:00:00Z'), { open: false, opens: 'Sat 09:00' }); // Fri 22:00
  assert.deepEqual(at('2026-11-22T18:30:00Z'), { open: false, opens: 'Mon 07:00' }); // Sun 19:30
  assert.deepEqual(at('2027-03-27T22:30:00Z'), { open: false, opens: 'Sun 09:00' }); // Sat 23:30, night before DST
  assert.deepEqual(printWindowState({ weekday: null, weekend: null }, new Date('2026-11-18T02:00:00Z')), { open: true });
  assert.deepEqual(printWindowState({ weekday: windows.weekday, weekend: null }, new Date('2026-11-20T21:00:00Z')), { open: false, opens: 'Sat 00:00' });
});
