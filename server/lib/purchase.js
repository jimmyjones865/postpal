import { logger } from './logger.js';
import { prepareReceiver } from './address-rules.js';

const DHL_PDF_ORIGIN = 'https://internetmarke.deutschepost.de/';

async function fetchDhlPdf(url) {
  if (!url?.startsWith(DHL_PDF_ORIGIN)) {
    throw new Error(`Unexpected PDF URL: ${url}`);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`PDF download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Buys one label and stores its PDF. Shared by the UI route and the email intake.
 * Returns { success: true, label, newBalance } or { success: false, status, error, details, paid? }.
 * paid: true means DHL charged but the PDF could not be stored.
 */
export async function buyLabel({ storage, dhlClient, credentials }, { sender, receiver, productCode, productName, priceInCents, pageFormatId, recipientAddress, meta = {} }) {
  const prepared = prepareReceiver(receiver);
  if (prepared.errors.length) {
    return { success: false, status: 400, error: 'Invalid recipient address', details: prepared.errors.join('; ') };
  }

  const tokenData = await dhlClient.getAccessToken(credentials);
  const payload = dhlClient.buildPurchasePayload({
    sender,
    receiver: prepared.receiver,
    productCode,
    priceInCents,
    pageFormatId: parseInt(pageFormatId)
  });

  const result = await dhlClient.purchaseLabel(tokenData.accessToken, payload);
  if (!result.success) {
    return { success: false, status: result.status || 500, error: result.error, details: result.details };
  }

  // From here on the label is paid for — any failure must surface the DHL link
  try {
    const label = await storage.saveLabel(await fetchDhlPdf(result.pdfUrl), {
      recipientAddress,
      productCode,
      productName: productName || productCode,
      voucherId: result.voucherId,
      trackId: result.trackId,
      shopOrderId: result.shopOrderId,
      ...meta
    });
    return { success: true, label, newBalance: result.newBalance };
  } catch (err) {
    logger.error('[Purchase] Purchased but could not store PDF:', err.message, result.pdfUrl);
    return {
      success: false,
      status: 502,
      error: 'Label purchased, but the PDF could not be stored',
      details: `${err.message}. PDF: ${result.pdfUrl}`,
      paid: true,
      newBalance: result.newBalance
    };
  }
}
