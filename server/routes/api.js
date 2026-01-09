import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAddress } from '../lib/european-address-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApiRouter() {
  const router = express.Router();

  // Configuration from environment variables
  const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || '/data/labels';
  const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60', 10);

  // Deutsche Post API configuration
  const DHL_API_BASE = 'https://api-eu.dhl.com/post/de/shipping/im/v1';

  // Token cache
  let cachedToken = {
    accessToken: null,
    expiresAt: 0,
    walletBalance: null
  };

  let metadataWriteInProgress = false;

  async function withMetadataLock(fn) {
    while (metadataWriteInProgress) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    metadataWriteInProgress = true;
    try {
      return await fn();
    } finally {
      metadataWriteInProgress = false;
    }
  }

  // Ensure storage directory exists
  async function ensureStorageDir() {
    await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });
  }

  // Label metadata storage (JSON file)
  const METADATA_FILE = path.join(PDF_STORAGE_PATH, 'labels.json');

  async function loadMetadata() {
    try {
      const data = await fs.readFile(METADATA_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { labels: [] };
      }
      console.error('Metadata file is unreadable or corrupted:', err);
      throw err;
    }
  }

  async function saveMetadata(metadata) {
    await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
  }

  // Cleanup old labels
  async function cleanupOldLabels() {
    console.log(`Running cleanup for labels older than ${RETENTION_DAYS} days...`);
    const metadata = await loadMetadata();
    const now = Date.now();
    const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    
    const toKeep = [];
    const toDelete = [];
    
    for (const label of metadata.labels) {
      const age = now - new Date(label.createdAt).getTime();
      if (age > maxAge) {
        toDelete.push(label);
      } else {
        toKeep.push(label);
      }
    }
    
    // Delete old PDF files
    for (const label of toDelete) {
      try {
        await fs.unlink(path.join(PDF_STORAGE_PATH, label.filename));
        console.log(`Deleted old label: ${label.filename}`);
      } catch (err) {
        console.error(`Failed to delete ${label.filename}:`, err.message);
      }
    }
    
    metadata.labels = toKeep;
    await saveMetadata(metadata);
    console.log(`Cleanup complete. Deleted ${toDelete.length} labels, kept ${toKeep.length}.`);
  }

  // ==================== Deutsche Post API ====================

  // Get credentials from environment or request body
  function getCredentials(reqCredentials) {
    // Prefer environment variables, fall back to request body
    return {
      apiKey: process.env.DHL_API_KEY || reqCredentials?.apiKey,
      apiSecret: process.env.DHL_API_SECRET || reqCredentials?.apiSecret,
      portokasseLogin: process.env.DHL_PORTOKASSE_LOGIN || reqCredentials?.portokasseLogin,
      portokassePassword: process.env.DHL_PORTOKASSE_PASSWORD || reqCredentials?.portokassePassword
    };
  }

  // Authenticate and get token + wallet balance
  async function authenticateDHL(credentials) {
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
    
    console.log('Authenticating with Deutsche Post API...');
    console.log('Using credentials:', {
      apiKey: apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'MISSING',
      apiSecret: apiSecret ? `${apiSecret.length} chars` : 'MISSING',
      portokasseLogin: portokasseLogin || 'MISSING',
      portokassePassword: portokassePassword ? `${portokassePassword.length} chars` : 'MISSING'
    });
    
    // Log the encoded body (without secrets)
    console.log('Request body params:', body.toString().replace(/password=[^&]+/, 'password=***').replace(/client_secret=[^&]+/, 'client_secret=***'));
    
    const response = await fetch(`${DHL_API_BASE}/user`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    
    const responseText = await response.text();
    console.log('DHL auth response:', response.status, responseText);
    
    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} - ${responseText}`);
    }
    
    const data = JSON.parse(responseText);
    console.log('DHL auth successful, token received, balance:', data.walletBalance);
    
    return data;
  }

  // Get or refresh access token
  async function getAccessToken(credentials, forceRefresh = false) {
    const now = Date.now();
    
    // Return cached token if still valid (with 5 min buffer)
    if (!forceRefresh && cachedToken.accessToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
      return cachedToken;
    }
    
    const authData = await authenticateDHL(credentials);
    
    // Cache the token (valid for 24h, but we use the returned expires_in)
    const expiresIn = authData.expires_in || 86400; // Default 24h
    cachedToken = {
      accessToken: authData.access_token,
      expiresAt: now + expiresIn * 1000,
      walletBalance: authData.wallet_balance ?? authData.walletBalance ?? null
    };
    
    return cachedToken;
  }

  // Helper: Build address object, omitting empty fields
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

  // ==================== Routes ====================

  // Health check
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', storagePath: PDF_STORAGE_PATH, retentionDays: RETENTION_DAYS });
  });

  // Debug endpoint: Generate a dummy API call
  router.get('/debug/dummy-label-request', async (req, res) => {
    let sampleProduct = { code: '1', name: 'Standardbrief', cost: 0.95 };
    
    const dummySender = {
      name: 'Max Mustermann',
      addressLine1: 'Musterstraße 123',
      postalCode: '12345',
      city: 'Berlin',
      country: 'DEU'
    };
    
    const dummyReceiver = {
      name: 'Erika Beispiel',
      addressLine1: 'Beispielweg 456',
      postalCode: '54321',
      city: 'München',
      country: 'DEU'
    };
    
    const priceInCents = Math.round(sampleProduct.cost * 100);
    
    const payload = {
      type: 'AppShoppingCartPDFRequest',
      total: priceInCents,
      createShippingList: '0',
      dpi: 'DPI300',
      pageFormatId: 176,
      positions: [{
        productCode: sampleProduct.code,
        imageID: 0,
        address: {
          sender: dummySender,
          receiver: dummyReceiver
        },
        voucherLayout: 'ADDRESS_ZONE',
        positionType: 'AppShoppingCartPDFPosition',
        position: {
          labelX: 1,
          labelY: 1,
          page: 1
        }
      }]
    };
    
    const curlCommand = `curl --location '${DHL_API_BASE}/app/shoppingcart/pdf?directCheckout=true' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer YOUR_ACCESS_TOKEN' \\
--data '${JSON.stringify(payload)}'`;

    res.json({
      endpoint: `${DHL_API_BASE}/app/shoppingcart/pdf?directCheckout=true`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_ACCESS_TOKEN'
      },
      payload,
      curlCommand,
      notes: {
        priceInCents: `Product price ${sampleProduct.cost}€ = ${priceInCents} cents`,
        productCode: sampleProduct.code,
        productName: sampleProduct.name
      }
    });
  });

  // Get wallet balance
  router.post('/wallet/balance', async (req, res) => {
    try {
      const credentials = getCredentials(req.body.credentials);
      
      if (!credentials.apiKey) {
        return res.status(400).json({ error: 'Missing credentials' });
      }
      
      const tokenData = await getAccessToken(credentials, true);
      
      res.json({ 
        balance: tokenData.walletBalance,
        expiresAt: tokenData.expiresAt
      });
    } catch (err) {
      console.error('Failed to get wallet balance:', err);
      res.status(500).json({ error: err.message || 'Failed to get wallet balance' });
    }
  });

  // Purchase shipping label
  router.post('/labels/purchase', async (req, res) => {
    try {
      const { sender, receiver, productCode, priceInCents } = req.body;
      const credentials = getCredentials(req.body.credentials);
      
      if (!sender || !receiver || !productCode || priceInCents === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      const tokenData = await getAccessToken(credentials);
      
      const payload = {
        type: 'AppShoppingCartPDFRequest',
        total: priceInCents,
        createShippingList: '0',
        dpi: 'DPI300',
        pageFormatId: 176,
        positions: [{
          productCode: productCode,
          imageID: 0,
          address: {
            sender: buildAddressObject(sender),
            receiver: buildAddressObject(receiver)
          },
          voucherLayout: 'ADDRESS_ZONE',
          positionType: 'AppShoppingCartPDFPosition',
          position: {
            labelX: 1,
            labelY: 1,
            page: 1
          }
        }]
      };
      
      console.log('Purchasing label with payload:', JSON.stringify(payload, null, 2));
      
      const response = await fetch(`${DHL_API_BASE}/app/shoppingcart/pdf?directCheckout=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenData.accessToken}`
        },
        body: JSON.stringify(payload)
      });
      
      const responseText = await response.text();
      console.log(`Label purchase response: status=${response.status}, body=${responseText}`);
      
      if (response.status !== 200) {
        console.error('Label purchase failed:', response.status, responseText);
        return res.status(response.status).json({ 
          error: `Label purchase failed: HTTP ${response.status}`,
          details: responseText,
          status: response.status
        });
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseErr) {
        console.error('Failed to parse label response as JSON:', responseText);
        return res.status(500).json({ 
          error: 'Invalid response from DHL API',
          details: responseText
        });
      }
      
      console.log('Label purchased successfully:', JSON.stringify(data, null, 2));
      
      // Extract voucherId from shoppingCart if available
      const voucherId = data.shoppingCart?.voucherList?.[0]?.voucherId || null;
      const trackId = data.shoppingCart?.voucherList?.[0]?.trackId || null;
      
      // DHL API has a typo: "walletBallance" (double l)
      const newBalance = data.walletBallance ?? data.walletBalance ?? cachedToken?.walletBalance;
      
      // Update cached token balance
      if (newBalance !== undefined && cachedToken) {
        cachedToken.walletBalance = newBalance;
      }
      
      res.json({
        success: true,
        pdfUrl: data.link || data.pdfUrl || data.url,
        trackingNumber: trackId || voucherId || null,
        voucherId,
        newBalance,
        rawResponse: data
      });
    } catch (err) {
      console.error('Failed to purchase label:', err);
      res.status(500).json({ error: err.message || 'Failed to purchase label' });
    }
  });

  // Proxy PDF download from DHL (to avoid CORS issues)
  router.get('/proxy-pdf', async (req, res) => {
    try {
      const { url } = req.query;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
      }
      
      // Only allow DHL URLs for security
      if (!url.startsWith('https://internetmarke.deutschepost.de/')) {
        return res.status(403).json({ error: 'Only Deutsche Post URLs are allowed' });
      }
      
      console.log('Proxying PDF from:', url);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error('PDF fetch failed:', response.status);
        return res.status(response.status).json({ error: 'Failed to fetch PDF' });
      }
      
      const contentType = response.headers.get('content-type') || 'application/pdf';
      const buffer = await response.arrayBuffer();
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', 'inline; filename="label.pdf"');
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error('PDF proxy error:', err);
      res.status(500).json({ error: 'Failed to proxy PDF' });
    }
  });

  // Parse address
  router.post('/parse-address', (req, res) => {
    try {
      const { address } = req.body;
      
      if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'Missing address field' });
      }
      
      console.log('Parsing address:', address);
      const result = parseAddress(address);
      console.log('Parsed result:', JSON.stringify(result));
      
      res.json(result);
    } catch (err) {
      console.error('Failed to parse address:', err);
      res.status(500).json({ error: 'Failed to parse address' });
    }
  });

  // Save a new label
  router.post('/labels', async (req, res) => {
    try {
      await ensureStorageDir();
      const { pdfBase64, recipientAddress, productCode, productName, einschreiben } = req.body;
      
      if (!pdfBase64 || !recipientAddress || !productCode) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const filename = `${id}.pdf`;
      const filepath = path.join(PDF_STORAGE_PATH, filename);
      
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      await fs.writeFile(filepath, pdfBuffer);
      
      const metadata = await loadMetadata();
      const labelInfo = {
        id,
        filename,
        recipientAddress,
        productCode,
        productName,
        einschreiben: einschreiben || false,
        createdAt: new Date().toISOString(),
      };
      metadata.labels.unshift(labelInfo);
      await saveMetadata(metadata);
      
      console.log(`Saved label: ${filename}`);
      res.json({ success: true, label: labelInfo });
    } catch (err) {
      console.error('Failed to save label:', err);
      res.status(500).json({ error: 'Failed to save label' });
    }
  });

  // Get all labels
  router.get('/labels', async (req, res) => {
    try {
      await ensureStorageDir();
      const metadata = await loadMetadata();
      res.json(metadata.labels);
    } catch (err) {
      console.error('Failed to get labels:', err);
      res.status(500).json({ error: 'Failed to get labels' });
    }
  });

  // Get a specific label PDF
  router.get('/labels/:id/pdf', async (req, res) => {
    try {
      const metadata = await loadMetadata();
      const label = metadata.labels.find(l => l.id === req.params.id);
      
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      const filepath = path.join(PDF_STORAGE_PATH, label.filename);
      const pdfBuffer = await fs.readFile(filepath);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${label.filename}"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('Failed to get PDF:', err);
      res.status(500).json({ error: 'Failed to get PDF' });
    }
  });

  // Delete a label
  router.delete('/labels/:id', async (req, res) => {
    try {
      const metadata = await loadMetadata();
      const labelIndex = metadata.labels.findIndex(l => l.id === req.params.id);
      
      if (labelIndex === -1) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      const label = metadata.labels[labelIndex];
      
      try {
        await fs.unlink(path.join(PDF_STORAGE_PATH, label.filename));
      } catch (err) {
        console.warn(`Could not delete file ${label.filename}:`, err.message);
      }
      
      metadata.labels.splice(labelIndex, 1);
      await saveMetadata(metadata);
      
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete label:', err);
      res.status(500).json({ error: 'Failed to delete label' });
    }
  });

  // Initialize storage and schedule cleanup
  ensureStorageDir().then(() => {
    cleanupOldLabels();
    setInterval(cleanupOldLabels, 24 * 60 * 60 * 1000);
  });

  return router;
}
