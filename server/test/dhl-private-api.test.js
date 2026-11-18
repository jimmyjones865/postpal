import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogPrice, createPakClient } from '../lib/dhl-private-api.js';

const catalog = {
  products: {
    PAK02: { regions: [{ countries: ['DEU'], price: { amount: '6.19' } }, { countries: ['EU'], price: { amount: '14.49' } }, { countries: ['CHE'], price: { amount: '30.00' } }], availableServices: ['VERSI', 'HVERSI1000'] },
    PAECK: { regions: [{ countries: ['DEU'], price: { amount: '5.19' } }], availableServices: ['ROLLE'] },
  },
  services: { VERSI: { regions: [{ countries: ['DEU'], price: { amount: '6.99' } }] }, HVERSI1000: { regions: [{ countries: ['EU', 'CHE'], price: { amount: '14.00' } }] } },
};

test('catalogPrice: base, EU region, insurance, unavailable', () => {
  assert.equal(catalogPrice(catalog, 'PAK02', 'DEU'), 6.19);
  assert.equal(catalogPrice(catalog, 'PAK02', 'NLD'), 14.49);
  assert.equal(catalogPrice(catalog, 'PAK02', 'CHE'), 30);
  assert.equal(catalogPrice(catalog, 'PAK02', 'DEU', { insurance: 'VERSI' }), 13.18);
  assert.equal(catalogPrice(catalog, 'PAK02', 'NLD', { insurance: 'VERSI' }), null);
  assert.equal(catalogPrice(catalog, 'PAK02', 'NLD', { insurance: 'HVERSI1000' }), 28.49);
  assert.equal(catalogPrice(catalog, 'PAECK', 'DEU', { insurance: 'VERSI' }), null);
  assert.equal(catalogPrice(catalog, 'PAK02', 'USA'), null);
  assert.equal(catalogPrice(catalog, 'NOPE', 'DEU'), null);
});

const fakeFetch = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('getCart: unknown id → null, other errors throw', async () => {
  const unknown = createPakClient({ apiKey: 'k', fetchFn: fakeFetch(400, { code: 'WRONG_SCID', detail: 'x' }) });
  assert.equal(await unknown.getCart('ABC'), null);
  const down = createPakClient({ apiKey: 'k', fetchFn: fakeFetch(500, { code: 'X', detail: 'down' }) });
  await assert.rejects(down.getCart('ABC'), /500 X/);
});

test('createCart: insurance + international payload', async () => {
  let sent;
  const client = createPakClient({ apiKey: 'k', fetchFn: async (url, opts) => {
    sent = JSON.parse(opts.body);
    return new Response(JSON.stringify({ shoppingcart: { state: 'PREPAID', download: { entryUrl: 'https://x' } } }), { status: 201 });
  } });
  await client.createCart({ productId: 'PAK05', insurance: 'VERSI', sender: { name2: 'S' }, receiver: { name2: 'R', country: 'DEU' }, email: 'a@b.c', notifyUrl: 'http://t?order=1' });
  const item = sent.shoppingcart.items[0];
  assert.equal(item.product.id, 'PAK05.VERSI');
  assert.deepEqual(item.services, { VERSI: {} });
  assert.equal(item.preAdvice, undefined);
  assert.equal(sent.shoppingcart.confirmation.notifyUrl, 'http://t?order=1');
  await client.createCart({ productId: 'PAK02', sender: {}, receiver: { country: 'NLD' }, email: 'a@b.c' });
  assert.equal(sent.shoppingcart.items[0].preAdvice, 'PA_RETURN');
});
