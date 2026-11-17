// Portokasse top-ups from the UI and the email intake share one ledger, so daily caps see both.

import fs from 'fs/promises';
import path from 'path';
import { envNum, berlinDay } from './config.js';

export const MIN_TOPUP_CENTS = 1000; // DHL minimum; below it DHL answers quotaExceeded
export const TOPUP_MAX_CENTS = Math.round(envNum('TOPUP_MAX_EUR', 50) * 100);
// All top-ups per Berlin day, UI + auto
export const TOPUP_DAILY_MAX_CENTS = Math.round(envNum('TOPUP_DAILY_MAX_EUR', 100) * 100);

const KEEP_MS = 14 * 86_400_000;

/** DHL error title from a failed charge, else the HTTP status. */
export function chargeErrorTitle(result) {
  try { return JSON.parse(result.details).title || String(result.status); } catch { return String(result.status); }
}

export function createTopupLedger(dir) {
  const file = path.join(dir, 'topups.json');
  let entries = null;
  let writing = Promise.resolve();

  async function load() {
    if (entries) return;
    try {
      entries = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      entries = [];
    }
  }

  function save() {
    const cutoff = Date.now() - KEEP_MS;
    entries = entries.filter(e => Date.parse(e.at) >= cutoff);
    const snapshot = JSON.stringify(entries, null, 2);
    writing = writing.then(async () => {
      await fs.writeFile(`${file}.tmp`, snapshot);
      await fs.rename(`${file}.tmp`, file);
    });
    return writing;
  }

  /** Cents topped up today (Berlin). Unknown outcomes count: DHL may have charged. */
  async function todayCents(source) {
    await load();
    const today = berlinDay();
    return entries
      .filter(e => e.status !== 'rejected' && (!source || e.source === source) && berlinDay(e.at) === today)
      .reduce((sum, e) => sum + e.cents, 0);
  }

  /**
   * Charges via DHL, written as pending before the call so a lost response or crash still counts.
   * Returns chargeWallet's result; throws on transport errors (entry stays 'unknown').
   */
  async function charge(dhlClient, accessToken, cents, source) {
    await load();
    const entry = { at: new Date().toISOString(), cents, source, status: 'pending' };
    entries.push(entry);
    await save();
    try {
      const result = await dhlClient.chargeWallet(accessToken, cents);
      entry.status = result.success ? 'done' : 'rejected';
      return result;
    } catch (err) {
      entry.status = 'unknown';
      throw err;
    } finally {
      await save();
    }
  }

  return { todayCents, charge };
}
