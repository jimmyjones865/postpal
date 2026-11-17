/**
 * Deutsche Post / DHL API client for shipping labels.
 * Handles authentication, token caching, and label purchases.
 */

import { logger } from './logger.js';

const DHL_API_BASE = 'https://api-eu.dhl.com/post/de/shipping/im/v1';
// Bounds a hung request; a timed-out purchase may still have been booked (caller treats it as uncertain)
const DHL_TIMEOUT_MS = 30_000;

/**
 * Creates a DHL API client instance.
 * 
 * @returns {Object} DHL client interface
 */
export function createDhlClient() {
  // Token cache (in-memory, single-process)
  let cachedToken = {
    accessToken: null,
    expiresAt: 0,
    walletBalance: null
  };

  /**
   * Authenticates with the DHL API and returns token data.
   * 
   * @param {Object} credentials - API credentials
   * @returns {Object} Authentication response with access_token, expires_in, walletBalance
   */
  async function authenticate(credentials) {
    const { apiKey, apiSecret, portokasseLogin, portokassePassword } = credentials;

    if (!apiKey || !apiSecret || !portokasseLogin || !portokassePassword) {
      throw new Error('Missing API credentials');
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: apiKey,
      client_secret: apiSecret,
      username: portokasseLogin,
      password: portokassePassword
    });

    logger.info('[DHL] Authenticating...');
    logger.debug('[DHL] Body params (masked):', body.toString()
      .replace(/password=[^&]+/, 'password=***')
      .replace(/client_secret=[^&]+/, 'client_secret=***'));

    const response = await fetch(`${DHL_API_BASE}/user`, {
      method: 'POST',
      signal: AbortSignal.timeout(DHL_TIMEOUT_MS),
      headers: { 
        'Accept': 'application/json', 
        'Content-Type': 'application/x-www-form-urlencoded' 
      },
      body: body.toString()
    });

    const text = await response.text();
    logger.debug('[DHL] Auth response:', response.status, text);

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} - ${text}`);
    }

    const data = JSON.parse(text);
    logger.info('[DHL] Token received, balance:', data.walletBallance ?? data.walletBalance);
    return data;
  }

  /**
   * Gets an access token, using cache if valid.
   * 
   * @param {Object} credentials - API credentials
   * @param {boolean} forceRefresh - Force re-authentication
   * @returns {Object} Token data { accessToken, expiresAt, walletBalance }
   */
  async function getAccessToken(credentials, forceRefresh = false) {
    const now = Date.now();
    
    // Use cached token if valid (with 5-minute buffer)
    if (!forceRefresh && cachedToken.accessToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
      return cachedToken;
    }

    const authData = await authenticate(credentials);
    const expiresIn = authData.expires_in || 86400;

    cachedToken = {
      accessToken: authData.access_token,
      expiresAt: now + expiresIn * 1000,
      walletBalance: authData.walletBallance ?? authData.walletBalance ?? cachedToken.walletBalance
    };

    return cachedToken;
  }

  /**
   * Builds a DHL-formatted address object.
   * 
   * @param {Object} addr - Address with name, additionalName, addressLine1, etc.
   * @returns {Object} DHL address object
   */
  function buildAddressObject(addr) {
    const result = {};
    if (addr.name) result.name = addr.name;
    if (addr.additionalName) result.additionalName = addr.additionalName;
    if (addr.addressLine1) result.addressLine1 = addr.addressLine1;
    if (addr.addressLine2) result.addressLine2 = addr.addressLine2;
    if (addr.postalCode) result.postalCode = addr.postalCode;
    if (addr.city) result.city = addr.city;
    if (addr.country) result.country = addr.country;
    return result;
  }

  /**
   * Purchases a shipping label from DHL.
   * 
   * @param {string} accessToken - Valid access token
   * @param {Object} payload - Purchase payload
   * @returns {Object} Purchase response
   */
  async function purchaseLabel(accessToken, payload) {
    logger.debug('[DHL] Purchasing label:', JSON.stringify(payload, null, 2));

    const response = await fetch(`${DHL_API_BASE}/app/shoppingcart/pdf?directCheckout=true`, {
      method: 'POST',
      signal: AbortSignal.timeout(DHL_TIMEOUT_MS),
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${accessToken}` 
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    logger.debug(`[DHL] Purchase response status=${response.status}, body=${responseText}`);

    if (!response.ok) {
      return { 
        success: false, 
        status: response.status, 
        error: 'Label purchase failed', 
        details: responseText 
      };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      // 2xx = bought; the label is still retrievable by shopOrderId
      return { success: false, uncertain: true, error: 'Invalid DHL response', details: responseText };
    }
    return cartResult(data);
  }

  /** Checkout/retrieve response → label fields; updates the cached balance. */
  function cartResult(data) {
    const balance = data.walletBallance ?? data.walletBalance;
    if (balance !== undefined) cachedToken.walletBalance = balance;
    const voucher = data.shoppingCart?.voucherList?.[0];
    return {
      success: true,
      pdfUrl: data.link || data.pdfUrl || data.url,
      trackId: voucher?.trackId || null,
      voucherId: voucher?.voucherId || null,
      shopOrderId: data.shoppingCart?.shopOrderId || null,
      newBalance: cachedToken.walletBalance
    };
  }

  /** Reserves a shopOrderId. Nothing is bought; checkout with it can succeed only once. */
  async function initShoppingCart(accessToken) {
    const response = await fetch(`${DHL_API_BASE}/app/shoppingcart`, {
      method: 'POST',
      signal: AbortSignal.timeout(DHL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const text = await response.text();
    logger.debug(`[DHL] Init cart response status=${response.status}, body=${text}`);
    if (!response.ok) throw new Error(`Shopping cart init failed: ${response.status} - ${text}`);
    const shopOrderId = JSON.parse(text).shopOrderId;
    if (!shopOrderId) throw new Error(`Shopping cart init returned no shopOrderId: ${text}`);
    return shopOrderId;
  }

  /**
   * Looks up a checkout by shopOrderId.
   * Returns cartResult fields, { success: false, notFound: true } on 404, or { success: false, status, details }.
   */
  async function retrieveShoppingCart(accessToken, shopOrderId) {
    const response = await fetch(`${DHL_API_BASE}/app/shoppingcart/${encodeURIComponent(shopOrderId)}`, {
      signal: AbortSignal.timeout(DHL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const text = await response.text();
    logger.debug(`[DHL] Retrieve cart ${shopOrderId} status=${response.status}, body=${text}`);
    if (response.status === 404) return { success: false, notFound: true };
    if (!response.ok) return { success: false, status: response.status, details: text };
    return cartResult(JSON.parse(text));
  }

  /**
   * Tops up the Portokasse from its stored payment method.
   *
   * @returns {Object} { success, newBalance } or { success: false, status, details }
   */
  async function chargeWallet(accessToken, amountCents) {
    const response = await fetch(`${DHL_API_BASE}/app/wallet?amount=${amountCents}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(DHL_TIMEOUT_MS),
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const text = await response.text();
    logger.debug(`[DHL] Charge response status=${response.status}, body=${text}`);

    if (!response.ok) {
      return { success: false, status: response.status, details: text };
    }

    // 2xx = charged; an unreadable body must not turn that into an error
    let data = {};
    try { data = JSON.parse(text); } catch { logger.warn('[DHL] Charge OK but body not JSON:', text); }
    const balance = data.walletBallance ?? data.walletBalance;
    if (balance !== undefined) cachedToken.walletBalance = balance;
    return { success: true, newBalance: balance ?? null };
  }

  /**
   * Requests a refund (retoure) for one voucher. DHL books it asynchronously.
   *
   * @returns {Object} { success, shopRetoureId, retoureTransactionId } or { success: false, status, details }
   */
  async function refundVoucher(accessToken, { voucherId, shopOrderId }) {
    const shoppingCart = { voucherList: [{ voucherId }] };
    if (shopOrderId) shoppingCart.shopOrderId = shopOrderId;

    const response = await fetch(`${DHL_API_BASE}/app/retoure`, {
      method: 'POST',
      signal: AbortSignal.timeout(DHL_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ shoppingCart })
    });

    const text = await response.text();
    logger.debug(`[DHL] Retoure response status=${response.status}, body=${text}`);

    if (!response.ok) {
      return { success: false, status: response.status, details: text };
    }

    const data = JSON.parse(text);
    return {
      success: true,
      shopRetoureId: data.shopRetoureId,
      retoureTransactionId: data.retoureTransactionId
    };
  }

  /**
   * Builds a shopping cart payload for label purchase.
   * 
   * @param {Object} params - Purchase parameters
   * @returns {Object} Shopping cart payload
   */
  function buildPurchasePayload({ shopOrderId, sender, receiver, productCode, priceInCents, pageFormatId }) {
    return {
      type: 'AppShoppingCartPDFRequest',
      shopOrderId,
      total: priceInCents,
      createShippingList: '0',
      dpi: 'DPI300',
      pageFormatId: pageFormatId || 176,
      positions: [{
        productCode,
        imageID: 0,
        address: {
          sender: buildAddressObject(sender),
          receiver: buildAddressObject(receiver)
        },
        voucherLayout: 'ADDRESS_ZONE',
        positionType: 'AppShoppingCartPDFPosition',
        position: { labelX: 1, labelY: 1, page: 1 }
      }]
    };
  }

  return {
    getAccessToken,
    buildPurchasePayload,
    purchaseLabel,
    initShoppingCart,
    retrieveShoppingCart,
    chargeWallet,
    refundVoucher
  };
}
