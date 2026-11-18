import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitStreet, toPakAddress, tagOrderIds, dhlSenderProblem, createPaketService } from '../lib/paket.js';

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

test('tagOrderIds', () => {
  assert.deepEqual(tagOrderIds('http://postpal.lan/dhl-paid?order=123&cart=2'), ['123']);
  assert.deepEqual(tagOrderIds('http://postpal.lan/dhl-paid?order=1&order=ui-x&cart=1'), ['1', 'ui-x']);
  assert.deepEqual(tagOrderIds('https://www.dhl.de'), []);
  assert.deepEqual(tagOrderIds(undefined), []);
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
  const svc = createPaketService({ storage, settings, pakClient, storagePath: dir, publicUrl: 'http://pp', localUrl: 'http://10.0.0.50:3001', confirmEmail: 'm@x.io', notify: async t => notices.push(t), print: async () => ({ skipped: true }) });
  return { svc, notices, carts, saved, dir };
}

const order = { id: 'o1', source: 'ui', productId: 'PAK02', productName: 'Paket 2 kg', insurance: null, receiver: { name: 'R', addressLine1: 'Weg 2', postalCode: '10115', city: 'Berlin', country: 'DEU' }, recipientAddress: 'R\nWeg 2\n10115 Berlin' };
const paidCart = (orderId, pakIds = ['PAK1']) => ({ cartId: 'CART00000001', state: 'PAYED', notifyUrl: `http://pp/dhl-paid?order=${orderId}&cart=1`,
  items: pakIds.map(p => ({ state: 'PAYED', productId: 'PAK02', pakId: p, shipmentNumber: `SN${p}`, price: 6.19 })) });

test('pay flow: cart tagged, reopen guard, paid → stored once', async () => {
  const t = await setup({ cart: paidCart('o1') });
  const { payUrl } = await t.svc.addOrder(order);
  assert.equal(payUrl, 'http://pp/api/paket/pay/o1');
  const r1 = await t.svc.startPayment('o1');
  assert.equal(r1.entryUrl, 'https://dhl/entry/1');
  assert.equal(t.carts[0].shipments[0].receiver.email, undefined);
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
  assert.equal(t.notices.length, 0, 'outside purchase: no notice');
  cart = paidCart('gone');
  assert.equal((await t.svc.handlePaidCart('EEEEEEEEEEEE')).status, 'ignored');
  assert.match(t.notices.at(-1), /order gone unknown/);
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
  assert.match(t.notices.at(-1), /⏳ 1 Paket order not paid yet:\n• bob: Paket 2 kg → \[Tailscale\]\(<http:\/\/pp\/api\/paket\/pay\/o1>\) · \[LAN\]\(<http:\/\/10\.0\.0\.50:3001\/api\/paket\/pay\/o1>\)$/);
  await t.svc.remindUnpaid(new Date('2026-11-19T15:00:00Z'));
  assert.equal(t.notices.length, 1);
});

test('products: catalog prices per country, insurance variants, DE + EU only', async () => {
  const catalog = {
    products: {
      PAK05: { regions: [{ countries: ['DEU'], price: { amount: '7.69' } }, { countries: ['EU'], price: { amount: '17.49' } }], availableServices: ['VERSI', 'HVERSI1000'] },
      PAECKS: { regions: [{ countries: ['DEU'], price: { amount: '4.19' } }] },
    },
    services: { VERSI: { regions: [{ countries: ['DEU'], price: { amount: '6.99' } }] }, HVERSI1000: { regions: [{ countries: ['EU'], price: { amount: '14.00' } }] } },
  };
  const pakClient = { getCatalog: async () => catalog };
  const s = createPaketService({ storage: {}, settings: {}, pakClient, storagePath: '/nonexistent', publicUrl: 'http://pp', notify: async () => {}, print: async () => ({}) });
  assert.deepEqual(await s.products('DEU'), [
    { productId: 'PAECKS', insurance: null, name: 'DHL Päckchen S', price: 4.19 },
    { productId: 'PAK05', insurance: null, name: 'DHL Paket 5 kg', price: 7.69 },
    { productId: 'PAK05', insurance: 'VERSI', name: 'DHL Paket 5 kg versichert 2.500 €', price: 14.68 },
  ]);
  assert.deepEqual((await s.products('NLD')).map(p => [p.productId, p.insurance, p.price]), [['PAK05', null, 17.49], ['PAK05', 'HVERSI1000', 31.49]]);
  assert.deepEqual(await s.products('CHE'), []);
  const down = createPaketService({ storage: {}, settings: {}, pakClient: { getCatalog: async () => { throw new Error('x'); } }, storagePath: '/nonexistent', publicUrl: 'http://pp', notify: async () => {}, print: async () => ({}) });
  assert.equal(await down.products('DEU'), null);
});

test('pay all: one cart for every open order, items matched by position + recipient, CM email', async () => {
  const cmOrder = { ...order, id: '1315370697', source: 'cm', cmOrderId: '1315370697', receiver: { ...order.receiver, name: 'Bert', postalCode: '53119' } };
  const t = await setup({ cart: (id, carts) => ({
    cartId: id, state: 'PAYED', notifyUrl: carts[0].notifyUrl,
    // DHL returns items in request order; swapped here to prove recipient check wins over position
    items: [
      { state: 'PAYED', productId: 'PAK02', pakId: 'P2', shipmentNumber: 'S2', price: 6.19, position: 0, receiver: { name2: 'Bert', plz: '53119' } },
      { state: 'PAYED', productId: 'PAK02', pakId: 'P1', shipmentNumber: 'S1', price: 6.19, position: 1, receiver: { name2: 'R', plz: '10115' } },
    ],
  }) });
  assert.ok((await t.svc.payAll()).empty);
  await t.svc.addOrder(order);
  const added = await t.svc.addOrder(cmOrder);
  assert.equal(added.openCount, 2);
  assert.equal(added.payAllUrl, 'http://pp/api/paket/pay-all');
  assert.equal(added.payAllMd, '[Tailscale](<http://pp/api/paket/pay-all>) · [LAN](<http://10.0.0.50:3001/api/paket/pay-all>)');

  const r = await t.svc.payAll();
  assert.equal(r.entryUrl, 'https://dhl/entry/1');
  assert.equal(r.total, 2);
  assert.match(t.carts[0].notifyUrl, /^http:\/\/pp\/dhl-paid\?order=(o1|1315370697)&order=(o1|1315370697)&cart=1$/);
  const emails = Object.fromEntries(t.carts[0].shipments.map(s => [s.receiver.name2, s.receiver.email]));
  assert.deepEqual(emails, { R: undefined, Bert: 'shipment-1315370697@cardmarket.com' });
  assert.equal((await t.svc.payAll()).confirm !== undefined, true, 'reopen guard');
  assert.ok((await t.svc.startPayment('o1')).confirm, 'single link guarded too');

  assert.equal((await t.svc.handlePaidCart('CART00000009')).status, 'done');
  assert.deepEqual(t.saved.map(l => [l.meta.paketOrderId, l.pakId]), [['1315370697', 'P2'], ['o1', 'P1']]);
  const list = await t.svc.listOrders();
  assert.deepEqual(list.map(o => o.status), ['done', 'done']);
  assert.equal(t.notices.filter(n => n.includes('✅')).length, 2);
  assert.ok((await t.svc.payAll()).empty);
});

test('pay all: unmatched item → warned, matched ones still stored', async () => {
  const t = await setup({ cart: (id, carts) => ({
    cartId: id, state: 'PAYED', notifyUrl: carts[0].notifyUrl,
    items: [
      { state: 'PAYED', productId: 'PAK02', pakId: 'P1', shipmentNumber: 'S1', price: 6.19, position: 0, receiver: { name2: 'R', plz: '10115' } },
      { state: 'PAYED', productId: 'PAK02', pakId: 'PX', shipmentNumber: 'SX', price: 6.19, position: 1, receiver: { name2: 'Nobody', plz: '00000' } },
    ],
  }) });
  await t.svc.addOrder(order);
  await t.svc.addOrder({ ...order, id: 'o2', receiver: { ...order.receiver, name: 'Other' } });
  await t.svc.payAll();
  await t.svc.handlePaidCart('CART00000009');
  assert.deepEqual(t.saved.map(l => l.pakId), ['P1']);
  assert.match(t.notices.at(-1), /1 paid item\(s\) not matched.*SX → Nobody/);
});

test('manual order: recipient email passed to DHL', async () => {
  const t = await setup();
  await t.svc.addOrder({ ...order, receiver: { ...order.receiver, email: 'r@x.io' } });
  await t.svc.startPayment('o1');
  assert.equal(t.carts[0].shipments[0].receiver.email, 'r@x.io');
});

test('pollMails: done cart mail marked read + archived, readOnly in archive folder', async () => {
  const t = await setup({ cart: paidCart('o1') });
  await t.svc.addOrder(order);
  await t.svc.handlePaidCart('CART00000001');
  const ops = [];
  const mail = { uid: 7, internalDate: new Date(), envelope: { subject: 'Auftragsbestätigung Ihrer Online Frankierung CART00000001', from: [{ address: 'noreply@dhl.com' }] }, headers: Buffer.from('') };
  const client = {
    getMailboxLock: async (folder, opts) => { ops.push(['lock', folder, opts.readOnly]); return { release() {} }; },
    search: async () => [7],
    fetch: async function* () { yield mail; },
    messageFlagsAdd: async (uids, flags) => ops.push(['flags', uids, flags]),
    messageMove: async (uids, dest) => ops.push(['move', uids, dest]),
  };
  await t.svc.pollMails(client, ['INBOX', 'Archive'], 'Archive');
  assert.deepEqual(ops, [['lock', 'INBOX', false], ['flags', [7], ['\\Seen']], ['move', [7], 'Archive'], ['lock', 'Archive', true]]);
  ops.length = 0;
  await t.svc.pollMails(client, ['INBOX'], '');
  assert.deepEqual(ops, [['lock', 'INBOX', true]]);
});
