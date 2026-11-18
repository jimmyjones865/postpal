import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buyLabel, recoverLabel } from '../lib/purchase.js';

const PDF = 'https://internetmarke.deutschepost.de/x.pdf';
const cart = { success: true, pdfUrl: PDF, voucherId: 'V1', trackId: 'T1', newBalance: 500 };

function fakes({ purchase, retrieve }) {
  const labels = [];
  const calls = { init: 0, purchase: [], retrieve: 0 };
  const dhlClient = {
    getAccessToken: async () => ({ accessToken: 'tok' }),
    initShoppingCart: async () => { calls.init++; return 'SO1'; },
    buildPurchasePayload: p => p,
    purchaseLabel: async (_t, payload, opts) => { calls.purchase.push(payload.shopOrderId); calls.direct = opts.directCheckout; return purchase(); },
    retrieveShoppingCart: async () => { calls.retrieve++; return retrieve(); }
  };
  const storage = {
    getAllLabels: async () => labels,
    saveLabel: async (_buf, info) => { const l = { id: `L${labels.length}`, ...info }; labels.push(l); return l; }
  };
  return { ctx: { dhlClient, storage, credentials: {} }, calls, labels };
}
const order = {
  sender: {}, receiver: { name: 'A B', addressLine1: 'Str 1', postalCode: '10115', city: 'Berlin', country: 'DEU' },
  productCode: '1', productName: 'Standardbrief', priceInCents: 95, recipientAddress: 'A B\nStr 1\n10115 Berlin'
};

mock.method(globalThis, 'fetch', async () => new Response(Buffer.from('%PDF')));
process.env.DPOST_DIRECT_CHECKOUT = 'false';

test('normal buy reserves a shopOrderId, persists it before checkout, stores it on the label', async () => {
  const { ctx, calls, labels } = fakes({ purchase: () => cart });
  const seen = [];
  const r = await buyLabel(ctx, { ...order, beforeCheckout: id => seen.push([id, calls.purchase.length]) });
  assert.equal(r.success, true);
  assert.deepEqual(seen, [['SO1', 0]]);
  assert.deepEqual(calls.purchase, ['SO1']);
  assert.equal(labels[0].shopOrderId, 'SO1');
});

test('lost response → lookup finds it → stored, no second checkout', async () => {
  const { ctx, calls } = fakes({ purchase: () => { throw new Error('timeout'); }, retrieve: () => cart });
  const r = await buyLabel(ctx, order);
  assert.equal(r.success, true);
  assert.equal(calls.purchase.length, 1);
  assert.equal(calls.retrieve, 1);
});

test('lost response + 404 right away → uncertain, not "not bought"', async () => {
  const { ctx } = fakes({ purchase: () => { throw new Error('timeout'); }, retrieve: () => ({ success: false, notFound: true }) });
  const r = await buyLabel(ctx, order);
  assert.equal(r.uncertain, true);
  assert.equal(r.shopOrderId, 'SO1');
});

test('retry with known shopOrderId skips init; duplicate reject → recovered', async () => {
  const dup = { success: false, status: 400, details: '{"title":"invalidShopOrderID","detail":"Queued order duplicated"}' };
  const { ctx, calls } = fakes({ purchase: () => dup, retrieve: () => cart });
  const r = await buyLabel(ctx, { ...order, shopOrderId: 'OLD' });
  assert.equal(r.success, true);
  assert.equal(calls.init, 0);
  assert.deepEqual(calls.purchase, ['OLD']);
});

test('plain DHL rejection → failed, shopOrderId returned, no lookup', async () => {
  const { ctx, calls } = fakes({ purchase: () => ({ success: false, status: 400, details: '{"title":"invalidProductcode"}' }) });
  const r = await buyLabel(ctx, order);
  assert.equal(r.success, false);
  assert.equal(r.uncertain, undefined);
  assert.equal(calls.retrieve, 0);
});

test('recover: existing label reused, 404 → notFound, foreign PDF host refused', async () => {
  const f = fakes({ retrieve: () => cart });
  await recoverLabel(f.ctx, { shopOrderId: 'SO1', ...order });
  const again = await recoverLabel(f.ctx, { shopOrderId: 'SO1', ...order });
  assert.equal(again.label.id, 'L0');
  assert.equal(f.calls.retrieve, 1);

  const nf = await recoverLabel(fakes({ retrieve: () => ({ success: false, notFound: true }) }).ctx, { shopOrderId: 'X', ...order });
  assert.equal(nf.notFound, true);

  for (const pdfUrl of ['https://deutschepost.de.evil.org/x.pdf', 'http://internetmarke.deutschepost.de/x.pdf']) {
    const bad = await recoverLabel(fakes({ retrieve: () => ({ ...cart, pdfUrl }) }).ctx, { shopOrderId: 'Y', ...order });
    assert.equal(bad.paid, true, pdfUrl);
  }
  const tcb = await recoverLabel(fakes({ retrieve: () => ({ ...cart, pdfUrl: 'https://pcf-next.tcb.deutschepost.de/d?x=1' }) }).ctx, { shopOrderId: 'Z', ...order });
  assert.equal(tcb.success, true);
});

test('two-step: checkout without directCheckout; success without link → uncertain, looked up', async () => {
  const { ctx, calls } = fakes({ purchase: () => ({ ...cart, pdfUrl: undefined }), retrieve: () => cart });
  const r = await buyLabel(ctx, order);
  assert.equal(calls.direct, false);
  assert.equal(r.success, true);
  assert.equal(calls.retrieve, 1);
});

test('direct mode: no init, DHL-returned shopOrderId stored, lost response → uncertain without lookup', async () => {
  process.env.DPOST_DIRECT_CHECKOUT = 'true';
  try {
    const ok = fakes({ purchase: () => ({ ...cart, shopOrderId: 'DHL9' }) });
    const seen = [];
    const r = await buyLabel(ok.ctx, { ...order, beforeCheckout: id => seen.push(id) });
    assert.equal(ok.calls.init, 0);
    assert.equal(ok.calls.direct, true);
    assert.deepEqual(seen, [undefined]);
    assert.equal(r.label.shopOrderId, 'DHL9');

    const lost = fakes({ purchase: () => { throw new Error('timeout'); }, retrieve: () => cart });
    const u = await buyLabel(lost.ctx, order);
    assert.equal(u.uncertain, true);
    assert.equal(u.shopOrderId, undefined);
    assert.equal(lost.calls.retrieve, 0);
  } finally {
    process.env.DPOST_DIRECT_CHECKOUT = 'false';
  }
});
