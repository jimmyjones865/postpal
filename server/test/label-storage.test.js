import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLabelStorage } from '../lib/label-storage.js';

test('cleanup: old indexed + old unindexed files go; new ones and json stay', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'labels-'));
  const storage = createLabelStorage(dir);
  const fresh = await storage.saveLabel(Buffer.from('%PDF'), { recipientAddress: 'A B\nX', productCode: '1' });
  const old = await storage.saveLabel(Buffer.from('%PDF'), { recipientAddress: 'C D\nX', productCode: '1' });
  await storage.updateLabel(old.id, { createdAt: '2020-01-01T00:00:00Z' });

  const past = new Date('2020-01-01');
  for (const f of ['old.png', 'old-orphan.pdf']) {
    await fs.writeFile(path.join(dir, f), 'x');
    await fs.utimes(path.join(dir, f), past, past);
  }
  await fs.writeFile(path.join(dir, 'new-orphan.pdf'), 'x');
  await fs.writeFile(path.join(dir, 'cm-orders.json'), '{}');
  await fs.utimes(path.join(dir, 'cm-orders.json'), past, past);

  const r = await storage.cleanupOldLabels(60);
  assert.deepEqual(r, { deleted: 3, kept: 1 });
  assert.deepEqual((await fs.readdir(dir)).sort(), ['cm-orders.json', fresh.filename, 'labels.json', 'new-orphan.pdf'].sort());
});
