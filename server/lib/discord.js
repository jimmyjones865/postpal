import { logger } from './logger.js';

/** Posts a message to DISCORD_WEBHOOK_URL. Never throws; a failed notice is logged only. */
export async function notify(text) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  logger.info('[Discord]', text);
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Buyer text is posted verbatim: no @everyone/@user pings from it
      body: JSON.stringify({ content: text.slice(0, 2000), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) logger.warn('[Discord] Webhook failed:', res.status, await res.text());
  } catch (err) {
    logger.warn('[Discord] Webhook error:', err.message);
  }
}
