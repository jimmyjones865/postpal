import express from 'express';
import { logger } from '../lib/logger.js';

const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font-family:Inter,system-ui,sans-serif;background:#2e3440;color:#eceff4;max-width:32rem;margin:3rem auto;padding:0 16px;line-height:1.5}
a{color:#88c0d0}a.btn{display:inline-block;margin-top:1rem;padding:.6rem 1rem;background:#5e81ac;color:#eceff4;border-radius:6px;text-decoration:none}</style></head>
<body><h2>${esc(title)}</h2>${body}</body></html>`;

export function createPaketRouter(paket) {
  const router = express.Router();

  router.get('/orders', async (req, res) => {
    res.json({ orders: await paket.listOrders() });
  });

  // Manual Paket buy from the UI. receiver = postpal receiver shape with ISO3 country.
  router.post('/orders', async (req, res) => {
    const { productId, productName, insurance, receiver, recipientAddress } = req.body || {};
    if (!productId || !receiver?.name || !receiver?.addressLine1 || !receiver?.postalCode || !receiver?.city || !/^[A-Z]{3}$/.test(receiver?.country || '')) {
      return res.status(400).json({ error: 'productId and receiver (name, addressLine1, postalCode, city, ISO3 country) required' });
    }
    const id = `ui-${Date.now().toString(36)}`;
    const r = await paket.addOrder({ id, source: 'ui', productId, productName: productName || productId, insurance: insurance || null, receiver, recipientAddress });
    res.status(201).json(r);
  });

  // Fallback when the confirmation mail doesn't arrive: cart id (Warenkorb-Nr) from DHL's thank-you page
  router.post('/carts/:cartId', async (req, res) => {
    const cartId = req.params.cartId.trim().toUpperCase();
    if (!/^[A-Z0-9]{12}$/.test(cartId)) return res.status(400).json({ error: 'Cart id = 12 letters/digits' });
    try {
      res.json(await paket.handlePaidCart(cartId, { source: 'manual' }));
    } catch (err) {
      logger.error('[Paket] Manual cart failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Discord/UI link: opens a fresh DHL cart for the order and redirects to DHL's checkout
  router.get('/pay/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const r = await paket.startPayment(id, { force: req.query.force === '1' });
      if (r.entryUrl) return res.redirect(303, r.entryUrl);
      if (r.done) return res.send(page('Already paid', '<p>The label is in the history.</p>'));
      if (r.confirm) {
        const at = new Date(r.confirm).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
        return res.send(page('Cart already opened', `<p>A DHL cart for this order was opened at ${esc(at)} and isn't confirmed paid yet.
If you paid, wait for DHL's confirmation mail (~1 min) — opening a new cart risks paying twice.</p>
<a class="btn" href="?force=1">Open a new cart anyway</a>`));
      }
      res.status(r.status || 500).send(page('Cannot open cart', `<p>${esc(r.error)}</p>`));
    } catch (err) {
      logger.error('[Paket] Pay failed:', err);
      res.status(502).send(page('DHL error', `<p>${esc(err.message)}</p><p>Nothing was paid. Reload to try again.</p>`));
    }
  });

  return router;
}
