import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTopupLedger } from '../lib/topups.js';
import { berlinDay } from '../lib/config.js';

const tmpDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'topups-'));
const client = outcome => ({
  async chargeWallet() {
    if (outcome === 'throw') throw new Error('socket hang up');
    return outcome === 'ok' ? { success: true, newBalance: 1500 } : { success: false, status: 400, details: '{"title":"quotaExceeded"}' };
  }
});

test('ledger: rejected charges free the cap, unknown outcomes count, survives reload', async () => {
  const dir = await tmpDir();
  const ledger = createTopupLedger(dir);
  await ledger.charge(client('ok'), 't', 1000, 'ui');
  await ledger.charge(client('rejected'), 't', 2500, 'auto');
  await assert.rejects(ledger.charge(client('throw'), 't', 2500, 'auto'), /socket/);
  assert.equal(await ledger.todayCents(), 3500);
  assert.equal(await ledger.todayCents('auto'), 2500);
  assert.equal(await ledger.todayCents('ui'), 1000);
  assert.equal(await createTopupLedger(dir).todayCents(), 3500);
});

test('berlinDay rolls at Berlin midnight, not UTC', () => {
  assert.equal(berlinDay('2026-11-17T22:30:00Z'), '2026-11-17'); // 23:30 CET
  assert.equal(berlinDay('2026-11-17T23:30:00Z'), '2026-11-18'); // 00:30 CET
  assert.equal(berlinDay('2026-07-17T22:30:00Z'), '2026-07-18'); // 00:30 CEST
});
