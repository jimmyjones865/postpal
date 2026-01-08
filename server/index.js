import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuration from environment variables
const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || '/data/labels';
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60', 10);
const PORT = process.env.API_PORT || 3001;

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

//async function loadMetadata() {
//  try {
//    const data = await fs.readFile(METADATA_FILE, 'utf-8');
//    return JSON.parse(data);
//  } catch {
//    return { labels: [] };
//  }
//}

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

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', storagePath: PDF_STORAGE_PATH, retentionDays: RETENTION_DAYS });
});

// Debug endpoint: Generate a dummy API call
app.get('/api/debug/dummy-label-request', async (req, res) => {
  // Load products to get a real product code
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
  
  // Price in cents
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

// ==================== Deutsche Post API ====================

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
  
  const response = await fetch(`${DHL_API_BASE}/user`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('DHL auth failed:', response.status, errorText);
    throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('DHL auth successful, token received');
  
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

// Endpoint: Get wallet balance (and refresh token)
app.post('/api/wallet/balance', async (req, res) => {
  try {
    const { credentials } = req.body;
    
    if (!credentials) {
      return res.status(400).json({ error: 'Missing credentials' });
    }
    
    // Force refresh to get current balance
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

// Endpoint: Purchase shipping label
app.post('/api/labels/purchase', async (req, res) => {
  try {
    const { credentials, sender, receiver, productCode, priceInCents } = req.body;
    
    if (!credentials || !sender || !receiver || !productCode || priceInCents === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get valid access token
    const tokenData = await getAccessToken(credentials);
    
    // Build the request payload
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
    
    // Check response status - only 200 means success
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
    
    // Parse response
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
    
    // The response should contain a PDF URL or PDF data
    res.json({
      success: true,
      pdfUrl: data.link || data.pdfUrl || data.url,
      trackingNumber: data.trackingNumber || data.voucherId || null,
      newBalance: data.walletBalance ?? cachedToken.walletBalance,
      rawResponse: data
    });
  } catch (err) {
    console.error('Failed to purchase label:', err);
    res.status(500).json({ error: err.message || 'Failed to purchase label' });
  }
});

// Address parser - using lightweight European regex parser
import { parseAddress } from './lib/european-address-parser.js';

app.post('/api/parse-address', (req, res) => {
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
app.post('/api/labels', async (req, res) => {
  try {
    const { pdfBase64, recipientAddress, productCode, productName, einschreiben } = req.body;
    
    if (!pdfBase64 || !recipientAddress || !productCode) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${id}.pdf`;
    const filepath = path.join(PDF_STORAGE_PATH, filename);
    
    // Decode and save PDF
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    await fs.writeFile(filepath, pdfBuffer);
    
    // Update metadata
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
    metadata.labels.unshift(labelInfo); // Most recent first
    await saveMetadata(metadata);
    
    console.log(`Saved label: ${filename}`);
    res.json({ success: true, label: labelInfo });
  } catch (err) {
    console.error('Failed to save label:', err);
    res.status(500).json({ error: 'Failed to save label' });
  }
});

// Get all labels
app.get('/api/labels', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    res.json(metadata.labels);
  } catch (err) {
    console.error('Failed to get labels:', err);
    res.status(500).json({ error: 'Failed to get labels' });
  }
});

// Get a specific label PDF
app.get('/api/labels/:id/pdf', async (req, res) => {
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
app.delete('/api/labels/:id', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const labelIndex = metadata.labels.findIndex(l => l.id === req.params.id);
    
    if (labelIndex === -1) {
      return res.status(404).json({ error: 'Label not found' });
    }
    
    const label = metadata.labels[labelIndex];
    
    // Delete PDF file
    try {
      await fs.unlink(path.join(PDF_STORAGE_PATH, label.filename));
    } catch (err) {
      console.warn(`Could not delete file ${label.filename}:`, err.message);
    }
    
    // Remove from metadata
    metadata.labels.splice(labelIndex, 1);
    await saveMetadata(metadata);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete label:', err);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

// Start server
await ensureStorageDir();
app.listen(PORT, () => {
  console.log(`Label storage API running on port ${PORT}`);
  console.log(`Storage path: ${PDF_STORAGE_PATH}`);
  console.log(`Retention: ${RETENTION_DAYS} days`);
});

// Run cleanup on startup and every 24 hours
cleanupOldLabels();
setInterval(cleanupOldLabels, 24 * 60 * 60 * 1000);
