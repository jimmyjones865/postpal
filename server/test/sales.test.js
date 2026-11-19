import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { parseBody } from '../lib/cm-email.js';
import { saleFromMail, pushMailSale, pushPostage } from '../lib/sales.js';

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('saleFromMail: numbers from mail strings, country only, no address', () => {
  const sale = saleFromMail('1234567', 'buyer1', parseBody(fixture('cm-de.txt')), new Date('2026-11-18T09:00:00Z'));
  assert.equal(sale.country, 'POL');
  assert.equal(sale.mailDate, '2026-11-18T09:00:00.000Z');
  assert.deepEqual([sale.totalEur, sale.commissionEur, sale.netEur, sale.shippingEur], [8.43, 0.36, 8.07, 1.55]);
  assert.equal(sale.items[0].priceEur, 1.72);
  assert.equal(sale.items[0].qty, 4);
  assert.ok(!('addressLines' in sale));
});

test('saleFromMail: thousands separator, empty parse', () => {
  const sale = saleFromMail('1', null, { totalEur: '1.314,18', items: [] }, undefined);
  assert.equal(sale.totalEur, 1314.18);
  assert.equal(sale.country, null);
  assert.equal(sale.mailDate, null);
});

test('push: posts to SALES_URL, off when unset, never throws when down', async () => {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { got.push({ url: req.url, body: JSON.parse(body) }); res.end('{}'); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const parsed = parseBody(fixture('cm-en.txt'));
  try {
    delete process.env.SALES_URL;
    await pushMailSale('1', 'b', parsed, null);
    assert.equal(got.length, 0);

    process.env.SALES_URL = `http://127.0.0.1:${server.address().port}`;
    await pushMailSale('1', 'b', parsed, null);
    await pushPostage('1', 1.8, 'Standardbrief');
    await pushPostage('1', null, 'x'); // no price → nothing sent
    assert.deepEqual(got.map(g => g.url), ['/api/sales', '/api/sales/1/postage']);
    assert.equal(got[0].body.shipmentId, '1');
    assert.deepEqual(got[1].body, { postageEur: 1.8, product: 'Standardbrief' });
  } finally {
    await new Promise(r => server.close(r));
  }
  await pushMailSale('1', 'b', parsed, null); // server closed: logs, resolves
  delete process.env.SALES_URL;
});
