import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDhlClient } from '../lib/dhl-api.js';

const V = 'A005FDD7010000001AA6';

async function stateFor(entry) {
  const body = JSON.stringify({ RetrieveRetoureStateResponse: entry ? [entry] : [] });
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
  try {
    return await createDhlClient().getRefundState('tok', { shopRetoureId: '17905529', voucherId: V });
  } finally {
    fetchMock.mock.restore();
  }
}

test('open while DHL still processes the voucher', async () => {
  const r = await stateFor({ countStillOpen: 1, refundedVouchers: [], notRefundedVouchers: [{ voucherId: V }] });
  assert.deepEqual(r, { success: true, state: 'open' });
});

test('refunded once the voucher is listed as refunded', async () => {
  const r = await stateFor({ countStillOpen: 0, refundedVouchers: [{ voucherId: V }], notRefundedVouchers: [] });
  assert.equal(r.state, 'refunded');
});

test('rejected when nothing is open and the voucher was not refunded', async () => {
  const r = await stateFor({ countStillOpen: 0, refundedVouchers: [], notRefundedVouchers: [{ voucherId: V }] });
  assert.equal(r.state, 'rejected');
});

test('unknown retoure is a failure', async () => {
  const r = await stateFor(null);
  assert.equal(r.success, false);
});
