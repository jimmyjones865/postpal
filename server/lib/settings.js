// Settings editable in the UI. settings.json in the data volume holds only overrides;
// effective value = override ?? env ?? code default. null in a patch drops the override (back to env).

import fs from 'fs';
import path from 'path';
import { loadServerConfig, envNum } from './config.js';
import { MIN_TOPUP_CENTS, TOPUP_MAX_CENTS } from './topups.js';
import { parseWindow } from './print-window.js';

const PRINTER_DEFAULTS = {
  printerName: '',
  paperFormatName: '',
  paperFormatId: 0,
  orientation: 'portrait',
  cropMarginTop: 5,
  cropMarginRight: 5,
  cropMarginBottom: 5,
  cropMarginLeft: 5,
  disableCropping: false,
  cupsUrl: '',
  enableDirectPrint: false,
  paperWidthMm: 62,
  paperHeightMm: 100,
  endlessRoll: true
};
const SENDER_DEFAULTS = { name: '', company: '', street: '', city: '', postalCode: '', country: 'DE' };
const HIDDEN_DEFAULTS = ['brief-standard', 'brief-gross', 'paket'];

function intakeFromEnv() {
  const autoTopupEur = envNum('AUTO_TOPUP_EUR', 0);
  return {
    dryRun: process.env.CM_DRY_RUN !== 'false',
    maxLabelsPerDay: envNum('CM_MAX_LABELS_PER_DAY', 30),
    autoTopupEur,
    // Default = one top-up per day: a mistake (loop, wrong price) costs at most one charge
    autoTopupDailyMaxEur: envNum('AUTO_TOPUP_DAILY_MAX_EUR', autoTopupEur),
    printWindowWeekday: process.env.PRINT_WINDOW_WEEKDAY?.trim() || '',
    printWindowWeekend: process.env.PRINT_WINDOW_WEEKEND?.trim() || ''
  };
}

export function defaultSettings() {
  const env = loadServerConfig();
  return {
    senderAddress: { ...SENDER_DEFAULTS, ...env.senderAddress },
    printerConfig: { ...PRINTER_DEFAULTS, ...env.printerConfig },
    hiddenProducts: HIDDEN_DEFAULTS,
    intake: intakeFromEnv()
  };
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const nonNeg = v => isNum(v) && v >= 0;

const CHECKS = {
  senderAddress: Object.fromEntries(Object.keys(SENDER_DEFAULTS).map(k => [k, v => typeof v === 'string'])),
  printerConfig: Object.fromEntries(Object.entries(PRINTER_DEFAULTS).map(([k, d]) =>
    [k, k === 'orientation' ? v => v === 'portrait' || v === 'landscape' : v => typeof v === typeof d && (!isNum(d) || nonNeg(v))])),
  intake: {
    dryRun: v => typeof v === 'boolean',
    maxLabelsPerDay: v => Number.isInteger(v) && v >= 0,
    autoTopupEur: v => v === 0 || (isNum(v) && v * 100 >= MIN_TOPUP_CENTS && v * 100 <= TOPUP_MAX_CENTS)
      || `0 (off) or ${MIN_TOPUP_CENTS / 100}–${TOPUP_MAX_CENTS / 100}`,
    autoTopupDailyMaxEur: nonNeg,
    printWindowWeekday: checkWindow,
    printWindowWeekend: checkWindow
  }
};

function checkWindow(v) {
  if (typeof v !== 'string') return false;
  try { parseWindow(v); return true; } catch (err) { return err.message; }
}

/** Throws { status: 400 } on the first bad key or value. */
function validate(patch) {
  const fail = msg => Object.assign(new Error(msg), { status: 400 });
  for (const [section, values] of Object.entries(patch)) {
    if (section === 'hiddenProducts') {
      if (values !== null && !(Array.isArray(values) && values.every(v => typeof v === 'string'))) throw fail('hiddenProducts: list of product codes');
      continue;
    }
    const checks = CHECKS[section];
    if (!checks || typeof values !== 'object' || values === null) throw fail(`unknown section ${section}`);
    for (const [key, v] of Object.entries(values)) {
      if (!checks[key]) throw fail(`unknown setting ${section}.${key}`);
      if (v === null) continue;
      const ok = checks[key](v);
      if (ok !== true) throw fail(`${section}.${key}: ${typeof ok === 'string' && key.startsWith('printWindow') ? ok : `invalid value ${JSON.stringify(v)}${typeof ok === 'string' ? ` (${ok})` : ''}`}`);
    }
  }
}

export function createSettingsStore(dir) {
  const file = path.join(dir, 'settings.json');
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let queue = Promise.resolve();

  function get() {
    const d = defaultSettings();
    return {
      senderAddress: { ...d.senderAddress, ...stored.senderAddress },
      printerConfig: { ...d.printerConfig, ...stored.printerConfig },
      hiddenProducts: stored.hiddenProducts ?? d.hiddenProducts,
      intake: { ...d.intake, ...stored.intake }
    };
  }

  /** Merges a partial { section: { key: value|null } } patch; resolves to the new effective settings. */
  function update(patch) {
    validate(patch);
    const run = queue.then(async () => {
      const next = structuredClone(stored);
      for (const [section, values] of Object.entries(patch)) {
        if (section === 'hiddenProducts') {
          if (values === null) delete next.hiddenProducts; else next.hiddenProducts = values;
          continue;
        }
        const s = next[section] ||= {};
        for (const [k, v] of Object.entries(values)) if (v === null) delete s[k]; else s[k] = v;
        if (!Object.keys(s).length) delete next[section];
      }
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2));
      await fs.promises.rename(tmp, file);
      stored = next;
      return get();
    });
    queue = run.catch(() => {});
    return run;
  }

  return { get, update, stored: () => structuredClone(stored), defaults: defaultSettings };
}
