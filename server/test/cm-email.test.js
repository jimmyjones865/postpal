import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchSubject, parseBody, decide, topHeader, senderProblem } from '../lib/cm-email.js';
import { prepareReceiver, sanitizeText, invalidChars } from '../lib/address-rules.js';

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const split = raw => {
  const [head, ...rest] = raw.split('\n\n');
  return { subject: head.replace(/^Subject: /, ''), text: rest.join('\n\n') };
};
const costTable = JSON.parse(fs.readFileSync(new URL('../cm-shipping.json', import.meta.url)));
const products = JSON.parse(fs.readFileSync(new URL('../../public/products.json', import.meta.url)));
const limits = { costTable, products, boughtToday: 0, maxPriceCents: 600, dailyCap: 30 };

test('subject filter', () => {
  assert.deepEqual(matchSubject('Bestellung 1315091264 für Zibi48PL: Bitte versenden'), { orderId: '1315091264', buyer: 'Zibi48PL' });
  assert.deepEqual(matchSubject('Shipment 1315022111 for Schmatan: Please ship'), { orderId: '1315022111', buyer: 'Schmatan' });
  assert.equal(matchSubject('Bestellung 1315091264 für Zibi48PL: Bezahlt'), null);
  assert.equal(matchSubject('Re: Shipment 1315022111 for Schmatan: Please ship'), null);
  assert.equal(matchSubject(undefined), null);
});

test('EN email → domestic Standardbrief', () => {
  const { subject, text } = split(fixture('cm-en.txt'));
  const body = parseBody(text.replace(/\n/g, '\r\n'));
  assert.deepEqual(body, {
    orderId: '1300000001',
    addressLines: ['Renée Strauß', 'Brühlstraße 12', '67069 Ludwigshafen', 'Germany'],
    costEur: '1.25',
    itemCount: 1,
    totalEur: '11,20'
  });
  const d = decide({ subjectOrderId: matchSubject(subject).orderId, ...body }, limits);
  assert.equal(d.ok, true, d.reason);
  assert.equal(d.product.code, '1');
  assert.equal(d.priceCents, 95);
  assert.equal(d.receiver.country, 'DEU');
  assert.equal(d.receiver.name, 'Renée Strauß');
});

test('DE email → international, Polish letters sanitized', () => {
  const { subject, text } = split(fixture('cm-de.txt'));
  const body = parseBody(text);
  assert.equal(body.costEur, '1.55');
  assert.equal(body.itemCount, 4);
  assert.equal(body.totalEur, '8,43');
  const d = decide({ subjectOrderId: matchSubject(subject).orderId, ...body }, limits);
  assert.equal(d.ok, true, d.reason);
  assert.equal(d.product.code, '10001');
  assert.equal(d.receiver.country, 'POL');
  const { receiver } = prepareReceiver(d.receiver);
  assert.equal(receiver.name, 'Lukasz Wisninski');
  assert.equal(receiver.addressLine1, 'Dluga 7B');
  assert.equal(receiver.city, 'Myszków');
});

test('real mails pad the cost column with spaces', () => {
  const { text } = split(fixture('cm-en.txt'));
  const padded = text.replace('Shipping 1,25 EUR', 'Shipping' + ' '.repeat(66) + '1,25 EUR');
  assert.equal(parseBody(padded).costEur, '1.25');
});

test('no-buy rules', () => {
  const { subject, text } = split(fixture('cm-en.txt'));
  const body = parseBody(text);
  const id = matchSubject(subject).orderId;
  const reason = (b, l = limits) => decide({ subjectOrderId: id, ...body, ...b }, l).reason;
  assert.match(reason({ costEur: '9.99' }), /unknown shipping cost 9,99 EUR/);
  assert.match(reason({ orderId: '1' }), /≠/);
  assert.match(reason({ costEur: '1.55' }), /does not fit destination DEU/);
  assert.match(reason({}, { ...limits, boughtToday: 30 }), /daily cap/);
  assert.match(reason({ costEur: '5.90', addressLines: ['A B', 'Długa 7', '42-300 Myszków', 'Polen'] }, { ...limits, maxPriceCents: 500 }), /> max 5/);
  assert.match(reason({ addressLines: ['A B', 'Musterallee', '81739 59', 'Germany'] }), /city "59" has no letters/);
  assert.match(reason({ addressLines: ['A B', 'Musterallee', '81739 München', 'Germany'] }), /street "Musterallee" has no house number/);
  assert.match(reason({ addressLines: ['Jan 王', 'Hauptstraße 1', '10115 Berlin', 'Germany'] }), /invalid characters: 王/);
});

test('swap puts the first input line on top (DHL prints additionalName above name)', () => {
  const { receiver } = prepareReceiver({ name: 'Enrique Frias Ramis', additionalName: 'Palma de Mallorca', addressLine1: 'X 1', postalCode: '07110', city: 'Bunyola', country: 'ESP' });
  assert.equal(receiver.additionalName, 'Enrique Frias Ramis');
  assert.equal(receiver.name, 'Palma de Mallorca');
  const long = prepareReceiver({ name: 'x'.repeat(41), additionalName: 'Firma', addressLine1: 'X 1', postalCode: '1', city: 'B', country: 'DEU' });
  assert.match(long.errors.join(), /additionalName has 41 chars \(max 40\)/);
});

test('sanitize', () => {
  assert.equal(sanitizeText('Łódź – Søren’s ñ ç'), "Lódz - Søren's n c");
  assert.equal(sanitizeText('Calle Mayor 3° 2ª, Nº 5'), 'Calle Mayor 3. 2., N. 5');
  assert.equal(sanitizeText('a\u00a0b'), 'a b');
  assert.deepEqual(invalidChars('Müller ąę'), []);
  assert.deepEqual(invalidChars('東京'), ['東', '京']);
});

test('sender: cardmarket.com domain, DKIM when Authentication-Results present', () => {
  const ar = 'mail.example.cc; dkim=pass header.d=cardmarket.com header.s=x header.b=y; dkim=pass header.d=amazonses.com; dmarc=pass header.from=cardmarket.com';
  assert.equal(senderProblem('noreply@cardmarket.com', ar), null);
  assert.equal(senderProblem('orders@mail.cardmarket.com', null), null);
  assert.equal(senderProblem('NoReply@CardMarket.com', null), null);
  assert.match(senderProblem('noreply@cardmarket.com.evil.org', null), /not cardmarket/);
  assert.match(senderProblem('noreply@evilcardmarket.com', null), /not cardmarket/);
  assert.match(senderProblem(undefined, null), /not cardmarket/);
  assert.match(senderProblem('noreply@cardmarket.com', 'mx; dkim=fail header.d=cardmarket.com; spf=pass'), /DKIM/);
  assert.match(senderProblem('noreply@cardmarket.com', 'mx; dkim=pass header.d=cardmarket.com.evil.org'), /DKIM/);
  assert.match(senderProblem('noreply@cardmarket.com', 'mx; dkim=fail header.d=cardmarket.com; dkim=pass header.d=amazonses.com'), /DKIM/);
});

test('topHeader takes the first (receiving server) instance, unfolded', () => {
  const raw = Buffer.from('Authentication-Results: mx;\r\n\tdkim=pass header.d=cardmarket.com\r\nAuthentication-Results: forged; dkim=pass\r\n\r\n');
  assert.equal(topHeader(raw, 'authentication-results'), 'mx; dkim=pass header.d=cardmarket.com');
  assert.equal(topHeader(Buffer.from('\r\n'), 'authentication-results'), null);
  assert.equal(topHeader(undefined, 'authentication-results'), null);
});
