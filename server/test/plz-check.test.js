import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plzCityWarning } from '../lib/plz-check.js';

const fake = names => async () => ({ ok: true, json: async () => names.map(name => ({ name })) });
const de = (postalCode, city) => ({ country: 'DEU', postalCode, city });

test('PLZ check: loose match passes, mismatch and unknown PLZ warn', async () => {
  assert.equal(await plzCityWarning(de('60311', 'Frankfurt'), fake(['Frankfurt am Main'])), null);
  assert.equal(await plzCityWarning(de('10115', 'Berlin-Mitte'), fake(['Berlin'])), null);
  assert.equal(await plzCityWarning(de('80331', 'MÜNCHEN'), fake(['München'])), null);
  assert.equal(await plzCityWarning(de('10115', 'Bremen'), fake(['Berlin'])), 'PLZ 10115 → Berlin, buyer wrote "Bremen"');
  assert.equal(await plzCityWarning(de('00000', 'Berlin'), fake([])), 'PLZ 00000 does not exist');
});

test('PLZ check: skipped outside DE, lookup failure is silent', async () => {
  const boom = async () => { throw new Error('down'); };
  assert.equal(await plzCityWarning({ country: 'AUT', postalCode: '1010', city: 'Wien' }, boom), null);
  assert.equal(await plzCityWarning(de('10115', 'Bremen'), boom), null);
  assert.equal(await plzCityWarning(de('10115', 'Bremen'), async () => ({ ok: false, status: 503 })), null);
});
