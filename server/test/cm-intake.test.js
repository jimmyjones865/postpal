import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBody } from '../lib/cm-email.js';

// cm-intake → print-label → pdfjs needs canvas, which doesn't build on the Alpine host
const canvas = await import('canvas').then(() => true, () => false);
const NO_CANVAS = !canvas && 'needs canvas: docker build -t postpal-test . && docker run --rm postpal-test npm test';
const publicDir = ['../../public', '../public'].map(p => new URL(p, import.meta.url).pathname).find(p => fs.existsSync(path.join(p, 'products.json')));

const fixture = name => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ADDRESS = 'Łukasz Wiśniński\nDługa 7B\n42-300 Myszków\nPolen';

/** In-memory mailbox: just the ImapFlow calls cm-intake makes. Subject search = substring match. */
class FakeImap {
  constructor(mails) { this.mails = mails; }
  on() {}
  async connect() {}
  async logout() {}
  close() {}
  async getMailboxLock(folder) { this.folder = folder; return { release() {} }; }
  async search(q) {
    const subjects = q.or.map(o => o.subject);
    return this.mails.filter(m => m.folder === this.folder && subjects.some(s => m.subject.includes(s))).map(m => m.uid);
  }
  async *fetch(uids) {
    for (const m of this.mails) {
      if (m.folder === this.folder && uids.includes(m.uid)) {
        yield { uid: m.uid, envelope: { subject: m.subject, from: [{ address: 'noreply@cardmarket.com' }], date: m.date }, internalDate: m.date, headers: Buffer.from('') };
      }
    }
  }
  async fetchOne(uid) {
    const m = this.mails.find(x => x.folder === this.folder && x.uid === uid);
    return m && { source: Buffer.from(`Subject: ${m.subject}\r\nFrom: noreply@cardmarket.com\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${m.body}`) };
  }
}

const mail = (uid, name) => {
  const [head, ...rest] = fixture(name).split('\n\n');
  return { uid, folder: 'INBOX', subject: head.replace(/^Subject: /, ''), body: rest.join('\n\n'), date: new Date() };
};

test('SOLD body: everything but the address', () => {
  const p = parseBody(mail(1, 'cm-sold-en.txt').body);
  assert.equal(p.orderId, '1300000002');
  assert.equal(p.addressLines, null);
  assert.equal(p.costEur, '1.55');
  assert.equal(p.itemCount, 4);
  assert.deepEqual([p.totalEur, p.commissionEur, p.netEur], ['8,43', '0,36', '8,07']);
});

test('manual order from SOLD mail; late ship mail is a duplicate', { skip: NO_CANVAS }, async () => {
  const { startCmIntake, stopCmIntake } = await import('../lib/cm-intake.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-intake-'));
  const past = new Date(Date.now() - 86_400_000).toISOString();
  fs.writeFileSync(path.join(dir, 'cm-orders.json'), JSON.stringify({ startedAt: past, soldSince: past, orders: {} }));
  Object.assign(process.env, { MAIL_SERVER: 'fake', MAIL_USERNAME: 'u', MAIL_PASSWORD: 'p', MAIL_ARCHIVE_FOLDER: '', MAIL_FOLDER: 'INBOX', STATIC_PATH: publicDir });
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.SALES_URL;
  const intakeSettings = { dryRun: true, maxLabelsPerDay: 30, autoTopupEur: 0, autoTopupDailyMaxEur: 0, printWindowWeekday: '', printWindowWeekend: '' };
  const settings = { get: () => ({ intake: intakeSettings, senderAddress: {}, printerConfig: {} }) };
  const mails = [mail(1, 'cm-sold-en.txt')];
  const intake = startCmIntake({ settings, storagePath: dir, getCredentials: () => ({}), createImap: () => new FakeImap(mails) });
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'cm-orders.json'), 'utf8'));
  try {
    assert.deepEqual(await intake.manualOrder('1300000099', ADDRESS), { error: 'no SOLD mail on record for this order', code: 404 });
    const bad = await intake.manualOrder('1300000002', 'just one line');
    assert.equal(bad.code, 400);
    assert.equal(state().orders['1300000002'], undefined, 'rejected address records nothing');

    assert.deepEqual(await intake.manualOrder('1300000002', ADDRESS), { status: 'dry-run', note: undefined });
    const first = state().orders['1300000002'];
    assert.equal(first.recipientAddress, ADDRESS);
    assert.equal((await intake.manualOrder('1300000002', ADDRESS)).code, 409);

    mails.push(mail(2, 'cm-de.txt'));
    await intake.pollNow();
    assert.deepEqual(state().orders['1300000002'], first, 'late ship mail not processed again');
  } finally {
    await stopCmIntake();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
