import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { TRACK_URL as LETTER_TRACK_URL } from '../lib/cm-intake.js';
import { TRACK_URL as PAKET_TRACK_URL } from '../lib/paket.js';
import { readCmOrders } from './intake.js';
import { parseAddress } from '../lib/european-address-parser.js';
import { getCountryCode, countryFlag } from '../lib/country-codes.js';

// First use starts the list this far back; older shipments count as done
const START_BACK_MS = 3 * 86_400_000;

const firstLine = text => (text || '').split('\n').find(l => l.trim())?.trim();
const flagOf = recipientAddress => countryFlag(getCountryCode(parseAddress(recipientAddress || '').country));

/** Tracked shipments (CM tracked letters + all Paket orders) until marked done. State: tracked-done.json { since, done: { key: at } }. */
export function createTrackedRouter({ storagePath, storage, paket }) {
  const router = express.Router();
  const file = path.join(storagePath, 'tracked-done.json');
  let queue = Promise.resolve();

  async function loadState() {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const state = { since: new Date(Date.now() - START_BACK_MS).toISOString(), done: {} };
      await saveState(state);
      return state;
    }
  }

  async function saveState(state) {
    await fs.writeFile(file + '.tmp', JSON.stringify(state, null, 2));
    await fs.rename(file + '.tmp', file);
  }

  const serial = fn => (queue = queue.then(fn, fn));

  async function shipments() {
    const [cm, paketOrders, labels] = await Promise.all([readCmOrders(storagePath), paket.listOrders(), storage.getAllLabels()]);
    const labelById = new Map(labels.map(l => [l.id, l]));
    const list = [];
    for (const [id, o] of Object.entries(cm)) {
      const label = o.status === 'bought' && o.tracked && o.labelId && labelById.get(o.labelId);
      const trackId = label && (label.trackId || label.voucherId);
      if (!trackId) continue;
      list.push({
        key: `cm:${id}`, kind: 'letter', at: o.at, buyer: o.buyer, flag: flagOf(o.recipientAddress), recipient: firstLine(o.recipientAddress),
        productName: o.productName, status: o.status,
        tracking: [{ id: trackId, url: LETTER_TRACK_URL + encodeURIComponent(trackId) }],
      });
    }
    for (const o of paketOrders) {
      list.push({
        key: `paket:${o.id}`, kind: 'parcel', at: o.at, buyer: o.buyer, recipient: firstLine(o.recipientAddress),
        flag: countryFlag(getCountryCode(o.receiver?.country)) || flagOf(o.recipientAddress),
        productName: o.productName, status: o.status,
        payUrl: o.status === 'awaiting-pay' ? o.payUrl : undefined,
        tracking: o.labels.map(l => ({ id: l.shipmentNumber, url: PAKET_TRACK_URL + encodeURIComponent(l.shipmentNumber) })),
      });
    }
    return list;
  }

  router.get('/', async (req, res) => {
    const [state, list] = await Promise.all([serial(loadState), shipments()]);
    const open = list
      .filter(s => !state.done[s.key] && Date.parse(s.at) >= Date.parse(state.since))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    res.json({ shipments: open });
  });

  router.post('/:key/done', async (req, res) => {
    const keys = new Set((await shipments()).map(s => s.key));
    if (!keys.has(req.params.key)) return res.status(404).json({ error: 'Unknown shipment' });
    await serial(async () => {
      const state = await loadState();
      state.done[req.params.key] = new Date().toISOString();
      // Source orders are pruned after 14 days; drop done marks for vanished ones
      for (const k of Object.keys(state.done)) if (!keys.has(k)) delete state.done[k];
      await saveState(state);
    });
    res.json({ ok: true });
  });

  return router;
}
