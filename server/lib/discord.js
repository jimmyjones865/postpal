import { logger } from './logger.js';

async function send(method, url, text) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    // Buyer text is posted verbatim: no @everyone/@user pings from it
    body: JSON.stringify({ content: text.slice(0, 2000), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) {
    logger.warn(`[Discord] Webhook ${method} failed:`, res.status, await res.text());
    return null;
  }
  return res;
}

/** Posts a message to DISCORD_WEBHOOK_URL. Never throws; a failed notice is logged only. With wait: resolves to the message id (null on failure). */
export async function notify(text, { wait = false } = {}) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  logger.info('[Discord]', text);
  if (!hook) return null;
  try {
    const url = new URL(hook);
    if (wait) url.searchParams.set('wait', 'true');
    const res = await send('POST', url, text);
    return wait && res ? (await res.json()).id ?? null : null;
  } catch (err) {
    logger.warn('[Discord] Webhook error:', err.message);
    return null;
  }
}

/** Replaces a webhook message's text. No time limit while the webhook exists; edits don't notify. Never throws. */
export async function editNotice(messageId, text) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  logger.info('[Discord] edit', messageId, text);
  if (!hook || !messageId) return false;
  try {
    const url = new URL(hook);
    // Query (thread_id) kept: the message lives in that thread
    url.pathname += `/messages/${messageId}`;
    return !!(await send('PATCH', url, text));
  } catch (err) {
    logger.warn('[Discord] Webhook edit error:', err.message);
    return false;
  }
}
