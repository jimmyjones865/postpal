import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../lib/logger.js';
import { TRACK_URL as LETTER_TRACK_URL } from '../lib/cm-intake.js';
import { TRACK_URL as PAKET_TRACK_URL } from '../lib/paket.js';
import { itemBlock } from '../lib/cm-email.js';

// Discord item block ("\n```\n…\n```") → plain lines
const itemLines = block => (block || '').split('\n').filter(l => l && l !== '```');

async function readCmState(storagePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(storagePath, 'cm-orders.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export const readCmOrders = async storagePath => (await readCmState(storagePath)).orders || {};

/** CM intake (cm-orders.json) + Paket orders for the UI, newest first; manual order for a lost ship mail. */
export function createIntakeRouter({ storagePath, storage, paket, settings, cmIntake }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const [state, paketOrders, labels] = await Promise.all([readCmState(storagePath), paket.listOrders(), storage.getAllLabels()]);
    const cm = state.orders || {};
    const labelById = new Map(labels.map(l => [l.id, l]));
    const paketById = new Map(paketOrders.map(o => [o.id, o]));

    const fromPaket = o => ({
      status: o.status,
      productName: o.productName,
      payUrl: o.status === 'awaiting-pay' ? o.payUrl : undefined,
      carts: o.carts.length,
      tracking: o.labels.map(l => ({ id: l.shipmentNumber, url: PAKET_TRACK_URL + encodeURIComponent(l.shipmentNumber) })),
      paket: { productId: o.productId, insurance: o.insurance, country: o.receiver?.country },
    });

    const orders = Object.entries(cm).map(([id, o]) => {
      const label = o.labelId && labelById.get(o.labelId);
      const trackId = o.tracked && label && (label.trackId || label.voucherId);
      return {
        id, source: 'cm', at: o.at, status: o.status, buyer: o.buyer, summary: o.summary,
        productName: o.productName, recipientAddress: o.recipientAddress, items: itemLines(o.itemList),
        note: o.reason || o.error,
        tracking: trackId ? [{ id: trackId, url: LETTER_TRACK_URL + encodeURIComponent(trackId) }] : [],
        ...(o.status === 'paket' && paketById.has(id) ? fromPaket(paketById.get(id)) : {}),
      };
    });
    for (const o of paketOrders) {
      if (o.source === 'cm' && cm[o.id]) continue;
      orders.push({ id: o.id, source: o.source, at: o.at, buyer: o.buyer, summary: o.summary, recipientAddress: o.recipientAddress, items: itemLines(o.itemList), ...fromPaket(o) });
    }
    orders.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    // Price only for what's still to pay; catalog is cached
    await Promise.all(orders.filter(o => o.payUrl).map(async o => {
      o.price = await paket.quote(o.paket.productId, o.paket.insurance, o.paket.country);
    }));
    // SOLD, no ship mail yet: candidates for a manual order (unpaid ones too — only CM knows)
    const sold = Object.entries(state.sold || {})
      .filter(([id, s]) => s.mail && !s.final && !cm[id])
      .map(([id, s]) => ({ id, at: s.mailAt, buyer: s.mail.buyer, summary: s.body.split('\n')[0], items: itemLines(itemBlock(s.mail.items)) }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    res.json({ dryRun: settings.get().intake.dryRun, orders, sold });
  });

  router.post('/:orderId/manual', async (req, res) => {
    const { orderId } = req.params;
    const address = req.body?.address;
    if (!/^\d+$/.test(orderId)) return res.status(400).json({ error: 'order ID = digits' });
    if (typeof address !== 'string' || !address.trim() || address.length > 500) return res.status(400).json({ error: 'address required (max 500 chars)' });
    const intake = cmIntake();
    if (!intake) return res.status(503).json({ error: 'CM intake off (MAIL_* not set)' });
    try {
      const r = await intake.manualOrder(orderId, address);
      res.status(r.code || 200).json(r);
    } catch (err) {
      logger.error('[CM] Manual order failed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
