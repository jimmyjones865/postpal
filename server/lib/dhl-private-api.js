// DHL Parcel DE "Private Shipping" (Online-Frankierung) API: carts are paid by hand in DHL's checkout,
// then read back here for the label.
import { logger } from './logger.js';
import { EU_ISO3 } from './country-codes.js';

const HOSTS = {
  prod: 'https://api-eu.dhl.com/parcel/de/shipping/of/v1/public',
  sandbox: 'https://api-sandbox.dhl.com/parcel/de/shipping/of/v1/public',
};
const TIMEOUT_MS = 30_000;
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export class PakApiError extends Error {
  constructor(status, code, detail) {
    super(`DHL Paket API ${status}${code ? ` ${code}` : ''}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.code = code;
  }
}

export function pakConfigFromEnv(env = process.env) {
  const sandbox = env.DHL_PAKET_SANDBOX === 'true';
  return {
    sandbox,
    apiKey: sandbox ? env.DHL_PAKET_API_KEY_SANDBOX : env.DHL_PAKET_API_KEY,
  };
}

// Explicit country beats a region id
const regionPrice = (regions, country) =>
  (regions?.find((r) => r.countries?.includes(country)) ?? (EU_ISO3.has(country) ? regions?.find((r) => r.countries?.includes('EU')) : undefined))?.price?.amount;

// Price in EUR for a product to an ISO3 country, insurance service (VERSI, HVERSI1000, …) included; null if not offered there.
export function catalogPrice(catalog, productId, country, { insurance } = {}) {
  const product = catalog?.products?.[productId];
  const base = regionPrice(product?.regions, country);
  if (base == null) return null;
  if (!insurance) return Number(base);
  if (!product.availableServices?.includes(insurance)) return null;
  const extra = regionPrice(catalog.services?.[insurance]?.regions, country);
  return extra == null ? null : Math.round((Number(base) + Number(extra)) * 100) / 100;
}

export function createPakClient({ apiKey, sandbox = false, fetchFn = fetch } = {}) {
  const base = sandbox ? HOSTS.sandbox : HOSTS.prod;
  let catalogCache = { data: null, at: 0 };

  async function call(path, { method = 'GET', body, accept = 'application/json' } = {}) {
    if (!apiKey) throw new Error('DHL Paket API key missing');
    const res = await fetchFn(base + path, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'dhl-api-key': apiKey,
        accept,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      let code, detail;
      try { ({ code, detail } = JSON.parse(text)); } catch { detail = text.slice(0, 300); }
      throw new PakApiError(res.status, code, detail);
    }
    return accept === 'application/pdf' ? Buffer.from(await res.arrayBuffer()) : res.json();
  }

  async function getCatalog({ force = false } = {}) {
    if (!force && catalogCache.data && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.data;
    const data = await call('/catalog/current/products');
    catalogCache = { data, at: Date.now() };
    return data;
  }

  // sender/receiver are DHL-shaped Address objects (name2, street, streetNumber, plz, city, country ISO3).
  // notifyUrl is never called back locally; it tags the cart so a paid cart maps to our order.
  async function createCart({ productId, insurance, sender, receiver, email, notifyUrl }) {
    const item = {
      type: 'ShipmentItem',
      product: { id: insurance ? `${productId}.${insurance}` : productId },
      address: { sender: { ...sender, email }, receiver },
      ...(insurance ? { services: { [insurance]: {} } } : {}),
      ...(receiver.country !== 'DEU' ? { preAdvice: 'PA_RETURN' } : {}),
    };
    const data = await call('/shopping-carts/pre-paid', {
      method: 'POST',
      body: { shoppingcart: { confirmation: { email, notifyUrl }, items: [item] } },
    });
    const entryUrl = data.shoppingcart?.download?.entryUrl;
    if (!entryUrl) throw new Error('DHL Paket cart created without entryUrl');
    logger.info('[DHL Paket] Cart created:', item.product.id, receiver.country);
    return { entryUrl, state: data.shoppingcart.state };
  }

  // null = DHL doesn't know this cart id.
  async function getCart(cartId) {
    let data;
    try {
      data = await call(`/shopping-carts/${encodeURIComponent(cartId)}`);
    } catch (err) {
      if (err.code === 'WRONG_SCID' || err.status === 404) return null;
      throw err;
    }
    const cart = data.shoppingcart;
    return {
      cartId: cart.shoppingCartId,
      state: cart.state,
      notifyUrl: cart.confirmation?.notifyUrl,
      items: (cart.items || []).map((i) => ({
        state: i.state,
        productId: i.product?.id,
        pakId: i.pakId,
        shipmentNumber: i.shipmentNumber,
        receiver: i.address?.receiver,
        price: (i.prices || []).reduce((sum, p) => sum + Number(p.amount || 0), 0),
      })),
    };
  }

  // MOPS = 70×170 mm standalone label; DINA4 = shop sheet with receipt.
  async function getLabel(pakId, format = 'MOPS') {
    return call(`/labels/${encodeURIComponent(pakId)}/${format}`, { accept: 'application/pdf' });
  }

  return { getCatalog, createCart, getCart, getLabel, sandbox };
}
