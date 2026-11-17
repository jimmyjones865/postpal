import { logger } from './logger.js';
import { prepareReceiver } from './address-rules.js';

// Checkout links come from internetmarke.deutschepost.de; the spec's retrieve example uses pcf-next.tcb.deutschepost.de
const DHL_PDF_HOST = /(^|\.)deutschepost\.de$/;

async function fetchDhlPdf(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Unexpected PDF URL: ${url}`); }
  if (u.protocol !== 'https:' || !DHL_PDF_HOST.test(u.hostname)) {
    throw new Error(`Unexpected PDF URL: ${url}`);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`PDF download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Paid cart → stored label. On failure the label stays retrievable via shopOrderId. */
async function storeLabel(storage, cart, shopOrderId, { recipientAddress, productCode, productName, meta = {} }) {
  try {
    const label = await storage.saveLabel(await fetchDhlPdf(cart.pdfUrl), {
      recipientAddress,
      productCode,
      productName: productName || productCode,
      voucherId: cart.voucherId,
      trackId: cart.trackId,
      shopOrderId,
      ...meta
    });
    return { success: true, label, newBalance: cart.newBalance };
  } catch (err) {
    logger.error('[Purchase] Purchased but could not store PDF:', err.message, cart.pdfUrl);
    return {
      success: false,
      status: 502,
      error: `Label purchased, but the PDF could not be stored — retrieve order ${shopOrderId}, don't buy again`,
      details: `${err.message}. PDF: ${cart.pdfUrl}`,
      paid: true,
      shopOrderId,
      newBalance: cart.newBalance
    };
  }
}

/**
 * Fetches and stores the label of an earlier checkout by shopOrderId.
 * Returns buyLabel-style results; { success: false, notFound: true } = DHL has no such order (not bought).
 */
export async function recoverLabel({ storage, dhlClient, credentials }, { shopOrderId, recipientAddress, productCode, productName, meta }) {
  const existing = (await storage.getAllLabels()).find(l => l.shopOrderId === shopOrderId);
  if (existing) return { success: true, label: existing };

  const tokenData = await dhlClient.getAccessToken(credentials);
  const cart = await dhlClient.retrieveShoppingCart(tokenData.accessToken, shopOrderId);
  if (cart.notFound) {
    return { success: false, status: 404, notFound: true, shopOrderId, error: `Order ${shopOrderId} not found at DHL — not bought` };
  }
  if (!cart.success) {
    return { success: false, status: cart.status || 502, shopOrderId, error: `Lookup of order ${shopOrderId} failed`, details: cart.details };
  }
  logger.info(`[Purchase] Recovered order ${shopOrderId}`);
  return storeLabel(storage, cart, shopOrderId, { recipientAddress, productCode, productName, meta });
}

/**
 * Buys one label and stores its PDF. Shared by the UI route and the email intake.
 * beforeCheckout(shopOrderId | undefined) runs right before the paid call: persist that a checkout was sent.
 * With DHL_TWO_STEP a shopOrderId is reserved first (or reused, for a retry): a retry can't double-buy
 * (if DHL enforces one checkout per id) and an unclear outcome can be looked up.
 * Returns { success: true, label, newBalance } or { success: false, status, error, details, shopOrderId?, paid?, uncertain? }.
 * paid: DHL charged but the PDF could not be stored. uncertain: may be charged, lookup didn't confirm yet.
 */
export async function buyLabel(ctx, { sender, receiver, productCode, productName, priceInCents, pageFormatId, recipientAddress, meta = {}, shopOrderId, beforeCheckout }) {
  const { dhlClient, credentials } = ctx;
  const prepared = prepareReceiver(receiver);
  if (prepared.errors.length) {
    return { success: false, status: 400, error: 'Invalid recipient address', details: prepared.errors.join('; ') };
  }

  // Two-step: reserved shopOrderId, checkout without directCheckout. Direct checkout ignores a passed id
  // (DHL assigns its own; seen 2026-11-17), so nothing can be looked up before the response arrives.
  const twoStep = process.env.DHL_TWO_STEP === 'true';
  const tokenData = await dhlClient.getAccessToken(credentials);
  const id = shopOrderId || (twoStep ? await dhlClient.initShoppingCart(tokenData.accessToken) : undefined);
  await beforeCheckout?.(id);
  const payload = dhlClient.buildPurchasePayload({
    shopOrderId: id,
    sender,
    receiver: prepared.receiver,
    productCode,
    priceInCents,
    pageFormatId: parseInt(pageFormatId)
  });
  const info = { recipientAddress, productCode, productName, meta };

  let result;
  try {
    result = await dhlClient.purchaseLabel(tokenData.accessToken, payload, { directCheckout: !twoStep });
  } catch (err) {
    // Request may have reached DHL before the connection dropped or timed out
    result = { success: false, uncertain: true, details: err.message };
  }
  if (result.success && !result.pdfUrl) {
    result = { success: false, uncertain: true, details: 'DHL returned no label link' };
  }
  if (result.success) return storeLabel(ctx.storage, result, result.shopOrderId || id, info);

  if (!id) {
    // Direct checkout: no shopOrderId known before the response, nothing to look up
    return result.uncertain
      ? { success: false, status: 504, uncertain: true, error: 'Purchase outcome unknown — check Portokasse before buying again', details: result.details }
      : { success: false, status: result.status || 500, error: result.error, details: result.details };
  }
  const duplicate = result.status === 400 && /invalidShopOrderID|duplicat/i.test(result.details || '');
  if (result.uncertain || duplicate) {
    const recovered = await recoverLabel(ctx, { shopOrderId: id, ...info }).catch(err => ({ success: false, details: err.message }));
    if (recovered.success || recovered.paid) return recovered;
    // 404 right after a timeout may just mean DHL is still processing
    return {
      success: false,
      status: 504,
      uncertain: true,
      shopOrderId: id,
      error: `Purchase outcome unknown — retrieve order ${id} before buying again`,
      details: [result.details, recovered.error, recovered.details].filter(Boolean).join(' — ')
    };
  }
  return { success: false, status: result.status || 500, error: result.error, details: result.details, shopOrderId: id };
}
