import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { TRACK_URL as LETTER_TRACK_URL } from '../lib/cm-intake.js';
import { TRACK_URL as PAKET_TRACK_URL } from '../lib/paket.js';

// Discord item block ("\n```\n…\n```") → plain lines
const itemLines = block => (block || '').split('\n').filter(l => l && l !== '```');

async function readCmOrders(storagePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(storagePath, 'cm-orders.json'), 'utf8')).orders || {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/** Read-only view of CM intake (cm-orders.json) + Paket orders for the UI, newest first. */
export function createIntakeRouter({ storagePath, storage, paket, settings }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const [cm, paketOrders, labels] = await Promise.all([readCmOrders(storagePath), paket.listOrders(), storage.getAllLabels()]);
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
    res.json({ dryRun: settings.get().intake.dryRun, orders });
  });

  return router;
}
