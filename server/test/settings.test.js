import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSettingsStore } from '../lib/settings.js';

const tmpDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'settings-'));

test('override wins over env, null drops it, survives reload', async () => {
  process.env.CM_MAX_LABELS_PER_DAY = '30';
  process.env.SENDER_CITY = 'Berlin';
  const dir = await tmpDir();
  const store = createSettingsStore(dir);
  assert.equal(store.get().intake.maxLabelsPerDay, 30);
  assert.equal(store.get().intake.dryRun, true);

  await store.update({ intake: { maxLabelsPerDay: 5, dryRun: false }, senderAddress: { name: 'X' } });
  const reloaded = createSettingsStore(dir).get();
  assert.equal(reloaded.intake.maxLabelsPerDay, 5);
  assert.equal(reloaded.intake.dryRun, false);
  assert.equal(reloaded.senderAddress.name, 'X');
  assert.equal(reloaded.senderAddress.city, 'Berlin');

  await store.update({ intake: { maxLabelsPerDay: null } });
  assert.equal(store.get().intake.maxLabelsPerDay, 30);
  assert.deepEqual(store.stored().intake, { dryRun: false });
});

test('rejects bad values without writing', async () => {
  const dir = await tmpDir();
  const store = createSettingsStore(dir);
  assert.throws(() => store.update({ intake: { autoTopupEur: 5 } }), /autoTopupEur.*0 \(off\) or 10/);
  assert.throws(() => store.update({ intake: { printWindowWeekday: '21-7' } }), /start must be before end/);
  assert.throws(() => store.update({ intake: { maxLabelsPerDay: -1 } }), /maxLabelsPerDay/);
  assert.throws(() => store.update({ printerConfig: { orientation: 'up' } }), /orientation/);
  assert.throws(() => store.update({ nope: {} }), /unknown section/);
  await assert.rejects(fs.access(path.join(dir, 'settings.json')));
  await store.update({ intake: { autoTopupEur: 0, printWindowWeekday: '' } });
  assert.equal(store.get().intake.autoTopupEur, 0);
});
