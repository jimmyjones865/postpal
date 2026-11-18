import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchSubject, parseBody, decide, topHeader, senderProblem, itemBlock } from '../lib/cm-email.js';
import { prepareReceiver, sanitizeText, invalidChars } from '../lib/address-rules.js';

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const split = raw => {
  const [head, ...rest] = raw.split('\n\n');
  return { subject: head.replace(/^Subject: /, ''), text: rest.join('\n\n') };
};
const costTable = JSON.parse(fs.readFileSync(new URL('../cm-shipping.json', import.meta.url)));
const products = JSON.parse(fs.readFileSync(new URL('../../public/products.json', import.meta.url)));
const limits = { costTable, products, boughtToday: 0, dailyCap: 30 };

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
    items: [{ qty: 1, name: 'Academy Manufactor (V.1) (Secret Lair Drop Series)', price: '9,95' }],
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
  assert.deepEqual(body.items, [{ qty: 4, name: 'Tekuthal, Inquiry Dominus (Commander: Edge of Eternities)', price: '1,72' }]);
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
  const big = parseBody('2x Box (Set) - English              650,00 EUR\nTotal                1.314,18 EUR');
  assert.deepEqual([big.items[0].price, big.totalEur], ['650,00', '1.314,18']);
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
  assert.match(reason({ addressLines: ['A B', 'Musterallee', '81739 59', 'Germany'] }), /city "59" has no letters/);
  assert.match(reason({ addressLines: ['A B', 'Musterallee', '81739 München', 'Germany'] }), /street "Musterallee" has no house number/);
  assert.match(reason({ addressLines: ['Jan 王', 'Hauptstraße 1', '10115 Berlin', 'Germany'] }), /invalid characters: 王/);
});

test('Paket costs: per destination, insurance suffix, no cap', () => {
  const { subject, text } = split(fixture('cm-en.txt'));
  const body = parseBody(text);
  const id = matchSubject(subject).orderId;
  const d = (b, l = limits) => decide({ subjectOrderId: id, ...body, ...b }, l);
  assert.deepEqual(d({ costEur: '7.19' }).paket, { productId: 'PAK02', insurance: null });
  assert.deepEqual(d({ costEur: '15.68' }).paket, { productId: 'PAK05', insurance: 'VERSI' });
  assert.equal(d({ costEur: '5.19' }, { ...limits, boughtToday: 30 }).ok, true, 'Paket ignores the label cap');
  const nl = ['Jan de Vries', 'Kerkstraat 7', '1017 GC Amsterdam', 'Netherlands'];
  assert.deepEqual(d({ costEur: '11.49', addressLines: nl }).paket, { productId: 'PAECK', insurance: null }, 'EU table, not DE PAK10');
  assert.deepEqual(d({ costEur: '11.49' }).paket, { productId: 'PAK10', insurance: null });
  assert.deepEqual(d({ costEur: '32.49', addressLines: nl }).paket, { productId: 'PAK05', insurance: 'HVERSI1000' });
  assert.match(d({ costEur: '7.19', addressLines: nl }).reason, /7,19 EUR has no Paket product for NLD/);
  const ch = ['Hans Muster', 'Bahnhofstrasse 1', '8001 Zürich', 'Switzerland'];
  assert.match(d({ costEur: '15.49', addressLines: ch }).reason, /no Paket product for CHE/);
  assert.equal(d({ costEur: '1.25' }).paket, undefined);
  const pk = d({ costEur: '32.49', addressLines: ['Łukasz Nowak', 'Kerkstraat 7', '1017 GC Amsterdam', 'Netherlands'] });
  assert.equal(pk.receiver.name, 'Lukasz Nowak', 'Paket receiver sanitized');
  const name40 = ['x'.repeat(40), 'Kerkstraat 7', '1017 GC Amsterdam', 'Netherlands'];
  assert.match(d({ costEur: '32.49', addressLines: name40 }).reason, /name has 40 chars \(max 35\)/, 'DHL Paket limit, not the letter one');
});

test('decide: no letter to Packstation / Postfiliale', () => {
  const { subject, text } = split(fixture('cm-en.txt'));
  const body = parseBody(text);
  const id = matchSubject(subject).orderId;
  const d = lines => decide({ subjectOrderId: id, ...body, costEur: '1.25', addressLines: lines }, limits);
  assert.match(d(['Erika Muster', '12345678', 'Packstation 123', '53113 Bonn', 'Germany']).reason, /letter to Packstation/);
  assert.match(d(['Erika Muster', 'Postfiliale 502', '53113 Bonn', 'Germany']).reason, /letter to Packstation\/Postfiliale/);
  assert.equal(d(['Erika Muster', 'Hauptstr. 5', '53113 Bonn', 'Germany']).ok, true);
});

test('prepareReceiver paket: house number, Packstation needs Postnummer', () => {
  const r = x => prepareReceiver({ name: 'Erika Muster', postalCode: '53113', city: 'Bonn', country: 'DEU', ...x }, { paket: true }).errors;
  assert.deepEqual(r({ addressLine1: 'Straße des 17. Juni' }), ['street "Str. des 17. Juni" has no house number']);
  assert.deepEqual(r({ addressLine1: 'Packstation 123', additionalName: '12345678' }), []);
  assert.deepEqual(r({ addressLine1: 'Packstation 123' }), ['Packstation without Postnummer (6–10 digits)']);
  assert.deepEqual(r({ name: '12345678', addressLine1: 'Packstation 123' }), ['Packstation: recipient name missing']);
  assert.deepEqual(r({ addressLine1: '12 rue de la Paix', country: 'FRA' }), []);
  assert.deepEqual(prepareReceiver({ name: 'A', addressLine1: 'Hauptstr.', postalCode: '1', city: 'B', country: 'DEU' }).errors, [], 'letters unchanged');
});

test('prepareReceiver: Straße → Str., Germany only', () => {
  const line = (addressLine1, country = 'DEU') => prepareReceiver({ name: 'A', addressLine1, postalCode: '1', city: 'B', country }).receiver.addressLine1;
  assert.equal(line('Hauptstraße 5'), 'Hauptstr. 5');
  assert.equal(line('Hauptstrasse 5a'), 'Hauptstr. 5a');
  assert.equal(line('Lange Straße 3'), 'Lange Str. 3');
  assert.equal(line('Straße des 17. Juni 1'), 'Str. des 17. Juni 1');
  assert.equal(line('HAUPTSTRASSE 5'), 'HAUPTSTR. 5');
  assert.equal(line('Straßenbahnring 2'), 'Straßenbahnring 2');
  assert.equal(line('Hauptstr. 5'), 'Hauptstr. 5');
  assert.equal(line('Hauptstrasse 5', 'CHE'), 'Hauptstrasse 5');
});

test('prepareReceiver paket: no swap, DHL limits', () => {
  const ok = prepareReceiver({ name: 'A', additionalName: 'x'.repeat(35), addressLine1: 'X 1', postalCode: '1', city: 'B', country: 'DEU' }, { paket: true });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.receiver.name, 'A');
  const long = prepareReceiver({ name: 'A', additionalName: 'x'.repeat(36), addressLine1: 'y'.repeat(36) + ' 1', postalCode: '1', city: 'B', country: 'DEU' }, { paket: true });
  assert.deepEqual(long.errors, ['additionalName has 36 chars (max 35)', 'street has 36 chars (max 35)']);
  const de = prepareReceiver({ name: 'A', additionalName: 'x'.repeat(20), addressLine1: 'X 1', addressLine2: 'y'.repeat(14), postalCode: '1', city: 'B', country: 'DEU' }, { paket: true });
  assert.deepEqual(de.errors, ['additionalName + addressLine2 have 36 chars (max 35 together for DE Paket)']);
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

test('item block caps at 5 lines', () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ qty: 1, name: `Card \`${i}`, price: '0,10' }));
  const block = itemBlock(items);
  assert.equal(block.split('\n').length, 9); // leading newline, ```, 5 items, more, ```
  assert.match(block, /^\n```\n1× Card '0 0,10\n/);
  assert.match(block, /… \+2 more\n```$/);
  assert.equal(itemBlock([]), '');
});
