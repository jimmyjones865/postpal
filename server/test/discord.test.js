import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notify, editNotice } from '../lib/discord.js';

test('notify with wait returns the message id; editNotice PATCHes it, thread query kept', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push([String(url), init.method]); return new Response(JSON.stringify({ id: '42' }), { status: 200 }); };
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/tok?thread_id=9';
  try {
    assert.equal(await notify('x', { wait: true }), '42');
    assert.equal(await notify('x'), null);
    assert.equal(await editNotice('42', 'y'), true);
    assert.deepEqual(calls, [
      ['https://discord.com/api/webhooks/1/tok?thread_id=9&wait=true', 'POST'],
      ['https://discord.com/api/webhooks/1/tok?thread_id=9', 'POST'],
      ['https://discord.com/api/webhooks/1/tok/messages/42?thread_id=9', 'PATCH']
    ]);
    globalThis.fetch = async () => new Response('gone', { status: 404 });
    assert.equal(await editNotice('42', 'y'), false);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DISCORD_WEBHOOK_URL;
  }
});
