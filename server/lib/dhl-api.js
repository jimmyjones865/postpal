/**
 * Deutsche Post / DHL API client for shipping labels.
 * Handles authentication, token caching, and label purchases.
 */

const DHL_API_BASE = 'https://api-eu.dhl.com/post/de/shipping/im/v1';

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

    console.log('[DHL] Authenticating...');
    console.log('[DHL] Body params (masked):', body.toString()
      .replace(/password=[^&]+/, 'password=***')
      .replace(/client_secret=[^&]+/, 'client_secret=***'));

    const response = await fetch(`${DHL_API_BASE}/user`, {
      method: 'POST',
      headers: { 
        'Accept': 'application/json', 
        'Content-Type': 'application/x-www-form-urlencoded' 
      },
      body: body.toString()
    });

    const text = await response.text();
    console.log('[DHL] Auth response:', response.status, text);

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} - ${text}`);
    }

    const data = JSON.parse(text);
    console.log('[DHL] Token received, balance:', data.walletBallance ?? data.walletBalance);
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
   * Gets the cached wallet balance.
   * 
   * @returns {number|null} Balance in cents or null
   */
  function getWalletBalance() {
    return cachedToken.walletBalance;
  }

  /**
   * Updates the cached wallet balance.
   * 
   * @param {number} balance - New balance in cents
   */
  function updateWalletBalance(balance) {
    cachedToken.walletBalance = balance;
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
    console.log('[DHL] Purchasing label:', JSON.stringify(payload, null, 2));

    const response = await fetch(`${DHL_API_BASE}/app/shoppingcart/pdf?directCheckout=true`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${accessToken}` 
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log(`[DHL] Purchase response status=${response.status}, body=${responseText}`);

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
      return { 
        success: false, 
        error: 'Invalid DHL response', 
        details: responseText 
      }; 
    }

    // Update wallet balance if returned
    if (data.walletBallance !== undefined || data.walletBalance !== undefined) {
      cachedToken.walletBalance = data.walletBallance ?? data.walletBalance;
    }

    const voucherId = data.shoppingCart?.voucherList?.[0]?.voucherId || null;
    const trackId = data.shoppingCart?.voucherList?.[0]?.trackId || null;

    return {
      success: true,
      pdfUrl: data.link || data.pdfUrl || data.url,
      trackingNumber: trackId || voucherId,
      voucherId,
      newBalance: cachedToken.walletBalance,
      rawResponse: data
    };
  }

  /**
   * Builds a shopping cart payload for label purchase.
   * 
   * @param {Object} params - Purchase parameters
   * @returns {Object} Shopping cart payload
   */
  function buildPurchasePayload({ sender, receiver, productCode, priceInCents, pageFormatId }) {
    return {
      type: 'AppShoppingCartPDFRequest',
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
    authenticate,
    getAccessToken,
    getWalletBalance,
    updateWalletBalance,
    buildAddressObject,
    buildPurchasePayload,
    purchaseLabel
  };
}
