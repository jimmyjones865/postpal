import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitStreet, toPakAddress, tagOrderId, dhlSenderProblem, createPaketService } from '../lib/paket.js';

test('splitStreet', () => {
  assert.deepEqual(splitStreet('Zimmerstr. 23'), { street: 'Zimmerstr.', streetNumber: '23' });
  assert.deepEqual(splitStreet('Hauptstraße 12 a'), { street: 'Hauptstraße', streetNumber: '12a' });
  assert.deepEqual(splitStreet('Am Ring 3-5'), { street: 'Am Ring', streetNumber: '3-5' });
  assert.deepEqual(splitStreet('Straße des 17. Juni 100'), { street: 'Straße des 17. Juni', streetNumber: '100' });
  assert.deepEqual(splitStreet('Packstation'), { street: 'Packstation', streetNumber: '' });
});

test('toPakAddress', () => {
  assert.deepEqual(toPakAddress({ name: 'A B', additionalName: 'Firma', addressLine1: 'Weg 1', addressLine2: 'HH', postalCode: '10115', city: 'Berlin', country: 'DEU' }),
    { name2: 'A B', name3: 'Firma', street: 'Weg', streetNumber: '1', addressAddition1: 'HH', plz: '10115', city: 'Berlin', country: 'DEU' });
});

test('tagOrderId', () => {
  assert.equal(tagOrderId('http://postpal.lan/dhl-paid?order=123&cart=2'), '123');
  assert.equal(tagOrderId('https://www.dhl.de'), null);
  assert.equal(tagOrderId(undefined), null);
});

test('dhlSenderProblem', () => {
  assert.equal(dhlSenderProblem('noreply@dhl.com', 'mx; dkim=pass header.d=dhl.com header.s=x'), null);
  assert.equal(dhlSenderProblem('noreply@dhl.com', undefined), null);
  assert.match(dhlSenderProblem('noreply@dhl.com.evil.io', undefined), /not @dhl.com/);
  assert.match(dhlSenderProblem('noreply@dhl.com', 'mx; dkim=fail header.d=dhl.com'), /DKIM/);
});

async function setup({ cart } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paket-'));
  const notices = [];
  const carts = [];
  const saved = [];
  const pakClient = {
    createCart: async args => { carts.push(args); return { entryUrl: `https://dhl/entry/${carts.length}` }; },
    getCart: async id => (typeof cart === 'function' ? cart(id, carts) : cart),
    getLabel: async () => Buffer.from('%PDF-'),
  };
  const storage = { saveLabel: async (pdf, info) => { const l = { id: `l${saved.length + 1}`, ...info }; saved.push(l); return l; } };
  const settings = { get: () => ({ senderAddress: { name: 'S', company: 'C', street: 'Zimmerstr. 23', postalCode: '10969', city: 'Berlin', country: 'Deutschland' }, printerConfig: { enableDirectPrint: false } }) };
  const svc = createPaketService({ storage, settings, pakClient, storagePath: dir, publicUrl: 'http://pp', confirmEmail: 'm@x.io', notify: async t => notices.push(t), print: async () => ({ skipped: true }) });
  return { svc, notices, carts, saved, dir };
}

const order = { id: 'o1', source: 'ui', productId: 'PAK02', productName: 'Paket 2 kg', insured: false, receiver: { name: 'R', addressLine1: 'Weg 2', postalCode: '10115', city: 'Berlin', country: 'DEU' }, recipientAddress: 'R\nWeg 2\n10115 Berlin' };
const paidCart = (orderId, pakIds = ['PAK1']) => ({ cartId: 'CART00000001', state: 'PAYED', notifyUrl: `http://pp/dhl-paid?order=${orderId}&cart=1`,
  items: pakIds.map(p => ({ state: 'PAYED', productId: 'PAK02', pakId: p, shipmentNumber: `SN${p}`, price: 6.19 })) });

test('pay flow: cart tagged, reopen guard, paid → stored once', async () => {
  const t = await setup({ cart: paidCart('o1') });
  const { payUrl } = await t.svc.addOrder(order);
  assert.equal(payUrl, 'http://pp/api/paket/pay/o1');
  const r1 = await t.svc.startPayment('o1');
  assert.equal(r1.entryUrl, 'https://dhl/entry/1');
  assert.equal(t.carts[0].notifyUrl, 'http://pp/dhl-paid?order=o1&cart=1');
  assert.deepEqual(t.carts[0].sender, { name2: 'S', name3: 'C', street: 'Zimmerstr.', streetNumber: '23', plz: '10969', city: 'Berlin', country: 'DEU' });
  assert.ok((await t.svc.startPayment('o1')).confirm);
  assert.equal((await t.svc.startPayment('o1', { force: true })).entryUrl, 'https://dhl/entry/2');

  const r = await t.svc.handlePaidCart('CART00000001');
  assert.equal(r.status, 'done');
  assert.equal(t.saved.length, 1);
  assert.equal(t.saved[0].trackId, 'SNPAK1');
  assert.match(t.notices.at(-1), /✅ Paket o1: Paket 2 kg 6.19 €, not printed/);
  assert.doesNotMatch(t.notices.at(-1), /Another paid cart/);
  await t.svc.handlePaidCart('CART00000001');
  assert.equal(t.saved.length, 1);
  assert.ok((await t.svc.startPayment('o1')).done);

  const persisted = JSON.parse(await fs.readFile(path.join(t.dir, 'paket-orders.json'), 'utf8'));
  assert.equal(persisted.orders.o1.status, 'done');
});

test('second paid cart for the same order → stored + warned', async () => {
  const t = await setup({ cart: id => ({ ...paidCart('o1', [id === 'CART00000001' ? 'PAK1' : 'PAK2']), cartId: id }) });
  await t.svc.addOrder(order);
  await t.svc.handlePaidCart('CART00000001');
  await t.svc.handlePaidCart('CART00000002');
  assert.equal(t.saved.length, 2);
  assert.match(t.notices.at(-1), /Another paid cart/);
});

test('untagged, unknown, unpaid, lookup error', async () => {
  let cart = { ...paidCart('o1'), notifyUrl: undefined };
  const t = await setup({ cart: () => { if (cart instanceof Error) throw cart; return cart; } });
  await t.svc.addOrder(order);
  assert.equal((await t.svc.handlePaidCart('AAAAAAAAAAAA')).status, 'ignored');
  assert.match(t.notices.at(-1), /not made by postpal/);
  cart = null;
  assert.equal((await t.svc.handlePaidCart('BBBBBBBBBBBB')).status, 'ignored');
  cart = { ...paidCart('o1'), state: 'PREPAID' };
  assert.equal((await t.svc.handlePaidCart('CCCCCCCCCCCC', { source: 'manual' })).status, 'not-paid');
  cart = new Error('timeout');
  assert.equal((await t.svc.handlePaidCart('DDDDDDDDDDDD')).status, 'error');
  const n = t.notices.length;
  await t.svc.handlePaidCart('DDDDDDDDDDDD');
  assert.equal(t.notices.length, n, 'error notified once');
  cart = paidCart('o1');
  assert.equal((await t.svc.handlePaidCart('DDDDDDDDDDDD')).status, 'done', 'error retried');
  assert.equal(t.saved.length, 1);
});

test('remindUnpaid: once per Berlin day from 09:00, only older orders', async () => {
  const t = await setup();
  await t.svc.addOrder({ ...order, buyer: 'bob' });
  const morning = new Date('2026-11-19T07:30:00Z'); // 08:30 Berlin
  await t.svc.remindUnpaid(morning);
  assert.equal(t.notices.length, 0);
  const later = new Date('2026-11-19T08:30:00Z');
  await t.svc.remindUnpaid(later);
  assert.match(t.notices.at(-1), /⏳ 1 Paket order not paid yet:\n• bob: Paket 2 kg → http:\/\/pp\/api\/paket\/pay\/o1/);
  await t.svc.remindUnpaid(new Date('2026-11-19T15:00:00Z'));
  assert.equal(t.notices.length, 1);
});
