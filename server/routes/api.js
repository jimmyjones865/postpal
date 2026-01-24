import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAddress } from '../lib/european-address-parser.js';
import { cropPdfWithPadding, rotatePdf, getContentDimensions } from '../lib/pdf-cropper.js';
import { sendToCups } from '../lib/cups-printer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============================================================
   Paper formats (loaded once)
   ============================================================ */

const paperFormatsPath = path.join(process.cwd(), 'public/paper-formats.json');

let paperFormatsJson = {};
try {
  const raw = await fs.readFile(paperFormatsPath, 'utf-8');
  paperFormatsJson = JSON.parse(raw);
} catch (err) {
  console.error('Failed to load paper formats JSON:', err);
}

const paperFormats = Object.values(paperFormatsJson).flat().filter(Boolean);

function getPageFormatIdByName(name) {
  if (!name) return null;
  const fmt = paperFormats.find(f => f.name === name);
  return fmt ? fmt.id : null;
}


export function createApiRouter() {
  const router = express.Router();

  const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || '/data/labels';
  const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60', 10);
  const DHL_API_BASE = 'https://api-eu.dhl.com/post/de/shipping/im/v1';

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

  async function ensureStorageDir() {
    await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });
  }

  const METADATA_FILE = path.join(PDF_STORAGE_PATH, 'labels.json');

  async function loadMetadata() {
    try {
      const data = await fs.readFile(METADATA_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') return { labels: [] };
      console.error('[Metadata] Failed to read metadata file:', err);
      throw err;
    }
  }

  async function saveMetadata(metadata) {
    await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
  }

  async function cleanupOldLabels() {
    console.log(`[Cleanup] Running for labels older than ${RETENTION_DAYS} days...`);
    const metadata = await loadMetadata();
    const now = Date.now();
    const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const toKeep = [];
    const toDelete = [];

    for (const label of metadata.labels) {
      const age = now - new Date(label.createdAt).getTime();
      if (age > maxAge) toDelete.push(label);
      else toKeep.push(label);
    }

    for (const label of toDelete) {
      try {
        await fs.unlink(path.join(PDF_STORAGE_PATH, label.filename));
        console.log(`[Cleanup] Deleted label: ${label.filename}`);
      } catch (err) {
        console.error(`[Cleanup] Failed to delete ${label.filename}:`, err.message);
      }
    }

    metadata.labels = toKeep;
    await saveMetadata(metadata);
    console.log(`[Cleanup] Complete. Deleted ${toDelete.length}, kept ${toKeep.length}.`);
  }

  /* ==================== Deutsche Post API ==================== */
  function getCredentials() {
    return {
      apiKey: process.env.DHL_API_KEY,
      apiSecret: process.env.DHL_API_SECRET,
      portokasseLogin: process.env.DHL_PORTOKASSE_LOGIN,
      portokassePassword: process.env.DHL_PORTOKASSE_PASSWORD
    };
  }

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

    console.log('[DHL] Authenticating...');
    console.log('[DHL] Body params (masked):', body.toString()
      .replace(/password=[^&]+/, 'password=***')
      .replace(/client_secret=[^&]+/, 'client_secret=***'));

    const response = await fetch(`${DHL_API_BASE}/user`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const text = await response.text();
    console.log('[DHL] Auth response:', response.status, text);

    if (!response.ok) throw new Error(`Authentication failed: ${response.status} - ${text}`);

    const data = JSON.parse(text);
    console.log('[DHL] Token received, balance:', data.walletBallance ?? data.walletBalance);
    return data;
  }

  async function getAccessToken(credentials, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedToken.accessToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
      return cachedToken;
    }

    const authData = await authenticateDHL(credentials);
    const expiresIn = authData.expires_in || 86400;

    cachedToken = {
      accessToken: authData.access_token,
      expiresAt: now + expiresIn * 1000,
      walletBalance: authData.walletBallance ?? authData.walletBalance ?? cachedToken.walletBalance
    };

    return cachedToken;
  }

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

  /* ==================== Routes ==================== */

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', storagePath: PDF_STORAGE_PATH, retentionDays: RETENTION_DAYS });
  });

  router.get('/credentials/status', (req, res) => {
    const hasCredentials = Boolean(
      process.env.DHL_API_KEY &&
      process.env.DHL_API_SECRET &&
      process.env.DHL_PORTOKASSE_LOGIN &&
      process.env.DHL_PORTOKASSE_PASSWORD
    );
    res.json({ configured: hasCredentials });
  });

  router.post('/parse-address', (req, res) => {
    try {
      const { address } = req.body;
      if (!address || typeof address !== 'string') return res.status(400).json({ error: 'Missing address field' });

      console.log('[ParseAddress] Input:', address);
      const result = parseAddress(address);
      console.log('[ParseAddress] Parsed:', JSON.stringify(result));

      res.json(result);
    } catch (err) {
      console.error('[ParseAddress] Error:', err);
      res.status(500).json({ error: 'Failed to parse address' });
    }
  });

  router.post('/labels/purchase', async (req, res) => {
    try {
      const { sender, receiver, productCode, priceInCents, pageFormatName } = req.body;
      const credentials = getCredentials(req.body.credentials);

      if (!sender || !receiver || !productCode || priceInCents === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const tokenData = await getAccessToken(credentials);

      const pageFormatId = getPageFormatIdByName(pageFormatName) || 176;

      const payload = {
        type: 'AppShoppingCartPDFRequest',
        total: priceInCents,
        createShippingList: '0',
        dpi: 'DPI300',
        pageFormatId,
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

      console.log('[PurchaseLabel] Payload:', JSON.stringify(payload, null, 2));

      const response = await fetch(`${DHL_API_BASE}/app/shoppingcart/pdf?directCheckout=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenData.accessToken}` },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      console.log(`[PurchaseLabel] Response status=${response.status}, body=${responseText}`);

      if (!response.ok) return res.status(response.status).json({ error: `Label purchase failed`, details: responseText, status: response.status });

      let data;
      try { data = JSON.parse(responseText); } catch { return res.status(500).json({ error: 'Invalid DHL response', details: responseText }); }

      // Update wallet balance if returned
      if (data.walletBallance !== undefined || data.walletBalance !== undefined) {
        cachedToken.walletBalance = data.walletBallance ?? data.walletBalance;
      }

      const voucherId = data.shoppingCart?.voucherList?.[0]?.voucherId || null;
      const trackId = data.shoppingCart?.voucherList?.[0]?.trackId || null;

      res.json({
        success: true,
        pdfUrl: data.link || data.pdfUrl || data.url,
        trackingNumber: trackId || voucherId,
        voucherId,
        newBalance: cachedToken.walletBalance,
        rawResponse: data
      });
    } catch (err) {
      console.error('[PurchaseLabel] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to purchase label' });
    }
  });

  /* Proxy PDF download */
  router.get('/proxy-pdf', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) return res.status(400).json({ error: 'Missing url parameter' });
      if (!url.startsWith('https://internetmarke.deutschepost.de/')) return res.status(403).json({ error: 'Only DHL URLs allowed' });

      console.log('[ProxyPDF] Fetching:', url);
      const response = await fetch(url);
      if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch PDF' });

      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="label.pdf"`);
      res.send(buffer);
    } catch (err) {
      console.error('[ProxyPDF] Error:', err);
      res.status(500).json({ error: 'Failed to proxy PDF' });
    }
  });

  /* Labels storage and retrieval */
  router.post('/labels', async (req, res) => {
    try {
      await ensureStorageDir();
      const { pdfBase64, recipientAddress, productCode, productName, einschreiben } = req.body;

      if (!pdfBase64 || !recipientAddress || !productCode) return res.status(400).json({ error: 'Missing required fields' });

      const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const filename = `${id}.pdf`;
      const filepath = path.join(PDF_STORAGE_PATH, filename);

      await fs.writeFile(filepath, Buffer.from(pdfBase64, 'base64'));

      const metadata = await loadMetadata();
      const labelInfo = { id, filename, recipientAddress, productCode, productName, einschreiben: einschreiben || false, createdAt: new Date().toISOString() };
      metadata.labels.unshift(labelInfo);
      await saveMetadata(metadata);

      console.log('[Labels] Saved label:', filename);
      res.json({ success: true, label: labelInfo });
    } catch (err) {
      console.error('[Labels] Save error:', err);
      res.status(500).json({ error: 'Failed to save label' });
    }
  });

  router.get('/labels', async (req, res) => {
    try {
      await ensureStorageDir();
      const metadata = await loadMetadata();
      res.json(metadata.labels);
    } catch (err) {
      console.error('[Labels] Get error:', err);
      res.status(500).json({ error: 'Failed to get labels' });
    }
  });

  router.get('/labels/:id/pdf', async (req, res) => {
    try {
      const { print, cropH, cropV } = req.query;
      const metadata = await loadMetadata();
      const label = metadata.labels.find(l => l.id === req.params.id);
      if (!label) return res.status(404).json({ error: 'Label not found' });

      let pdfBuffer = await fs.readFile(path.join(PDF_STORAGE_PATH, label.filename));

      if (print === '1') {
        try {
          pdfBuffer = await cropPdfWithPadding(pdfBuffer, parseFloat(cropH) || 5, parseFloat(cropV) || 5);
          console.log('[Labels] PDF cropped for printing');
        } catch (err) {
          console.error('[Labels] Crop failed, sending original:', err.message);
        }
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${label.filename}"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('[Labels] PDF error:', err);
      res.status(500).json({ error: 'Failed to get PDF' });
    }
  });

  router.delete('/labels/:id', async (req, res) => {
    try {
      const metadata = await loadMetadata();
      const idx = metadata.labels.findIndex(l => l.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Label not found' });

      try { await fs.unlink(path.join(PDF_STORAGE_PATH, metadata.labels[idx].filename)); } catch {}
      metadata.labels.splice(idx, 1);
      await saveMetadata(metadata);

      res.json({ success: true });
    } catch (err) {
      console.error('[Labels] Delete error:', err);
      res.status(500).json({ error: 'Failed to delete label' });
    }
  });

  /* Direct printing via CUPS IPP */
  router.post('/print', async (req, res) => {
    try {
      const { 
        labelId, cupsUrl, printerName, orientation, 
        cropH, cropV, disableCropping,
        // Explicit paper settings
        paperWidthMm, paperHeightMm, endlessRoll
      } = req.body;
      
      if (!labelId || !cupsUrl || !printerName) {
        return res.status(400).json({ error: 'Missing required fields: labelId, cupsUrl, printerName' });
      }
      
      // Load the label
      const metadata = await loadMetadata();
      const label = metadata.labels.find(l => l.id === labelId);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      // Read original PDF
      let pdfBuffer = await fs.readFile(path.join(PDF_STORAGE_PATH, label.filename));
      
      const cropMarginH = parseFloat(cropH) || 5;
      const cropMarginV = parseFloat(cropV) || 5;
      const isLandscape = orientation === 'landscape';
      
      // Get cropped dimensions and crop PDF
      let croppedDimensions = null;
      
      if (!disableCropping) {
        try {
          croppedDimensions = await getContentDimensions(pdfBuffer, cropMarginH, cropMarginV);
          pdfBuffer = await cropPdfWithPadding(pdfBuffer, cropMarginH, cropMarginV);
          console.log(`[Print] PDF cropped to ${croppedDimensions.cropped.widthMm}x${croppedDimensions.cropped.heightMm}mm`);
        } catch (cropErr) {
          console.error('[Print] Crop failed:', cropErr.message);
          
          // For endless roll, cropping is mandatory to determine height
          if (endlessRoll) {
            return res.status(500).json({ 
              error: 'PDF cropping failed',
              details: 'Cropping is required for endless roll to determine paper height. ' + cropErr.message
            });
          }
          // For fixed paper, continue with explicit dimensions
          console.log('[Print] Using explicit paper dimensions (crop failed)');
        }
      } else {
        console.log('[Print] Cropping disabled, using explicit paper dimensions');
      }
      
      // Calculate media dimensions
      let mediaWidthMm, mediaHeightMm;
      
      if (endlessRoll) {
        // Height from cropped content
        const contentWidth = croppedDimensions?.cropped?.widthMm || paperWidthMm || 62;
        const contentHeight = croppedDimensions?.cropped?.heightMm || 40;
        
        if (isLandscape) {
          // After 90° rotation: original width becomes the length (feed direction)
          mediaWidthMm = paperWidthMm || 62;
          mediaHeightMm = contentWidth;
        } else {
          mediaWidthMm = paperWidthMm || 62;
          mediaHeightMm = contentHeight;
        }
        
        console.log(`[Print] Endless roll ${isLandscape ? 'landscape' : 'portrait'}: width=${mediaWidthMm}mm, height=${mediaHeightMm.toFixed(1)}mm (from content)`);
      } else {
        // Fixed paper size
        const fixedWidth = paperWidthMm || 62;
        const fixedHeight = paperHeightMm || 100;
        
        if (isLandscape) {
          // Swap for landscape
          mediaWidthMm = fixedHeight;
          mediaHeightMm = fixedWidth;
        } else {
          mediaWidthMm = fixedWidth;
          mediaHeightMm = fixedHeight;
        }
        
        console.log(`[Print] Fixed paper ${isLandscape ? 'landscape' : 'portrait'}: ${mediaWidthMm}x${mediaHeightMm}mm`);
      }
      
      // Rotate PDF if landscape
      if (isLandscape) {
        try {
          pdfBuffer = await rotatePdf(pdfBuffer, 90);
          console.log('[Print] PDF rotated 90° for landscape');
        } catch (rotateErr) {
          console.error('[Print] Rotation failed:', rotateErr.message);
        }
      }
      
      // Send to CUPS with explicit dimensions
      const printResult = await sendToCups(pdfBuffer, cupsUrl, printerName, {
        jobName: `Label ${label.id}`,
        mediaWidthMm,
        mediaHeightMm
      });
      
      if (printResult.success) {
        console.log(`[Print] Job sent to ${printerName}, job ID: ${printResult.jobId}`);
        res.json({ 
          success: true, 
          jobId: printResult.jobId,
          message: `Print job sent to ${printerName}`,
          mediaDimensions: { widthMm: mediaWidthMm, heightMm: mediaHeightMm }
        });
      } else {
        console.error('[Print] Print failed:', printResult.error);
        res.status(500).json({ 
          success: false, 
          error: printResult.error || 'Failed to send print job'
        });
      }
    } catch (err) {
      console.error('[Print] Error:', err);
      res.status(500).json({ error: err.message || 'Print failed' });
    }
  });

  /* Preview cropped dimensions */
  router.post('/labels/:id/dimensions', async (req, res) => {
    try {
      const { cropH, cropV, disableCropping } = req.body;
      
      const metadata = await loadMetadata();
      const label = metadata.labels.find(l => l.id === req.params.id);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      const pdfBuffer = await fs.readFile(path.join(PDF_STORAGE_PATH, label.filename));
      
      const dimensions = await getContentDimensions(
        pdfBuffer,
        parseFloat(cropH) || 5,
        parseFloat(cropV) || 5
      );
      
      res.json({
        original: dimensions.original,
        cropped: disableCropping ? null : dimensions.cropped
      });
    } catch (err) {
      console.error('[Dimensions] Error:', err);
      res.status(500).json({ error: 'Failed to calculate dimensions' });
    }
  });

  /* Wallet */
  router.post('/wallet/balance', async (req, res) => {
    try {
      const credentials = getCredentials();
      if (!credentials.apiKey) return res.status(400).json({ error: 'Missing credentials' });

      const tokenData = await getAccessToken(credentials, true);
      res.json({ balance: tokenData.walletBalance, expiresAt: tokenData.expiresAt });
    } catch (err) {
      console.error('[Wallet] Balance error:', err);
      res.status(500).json({ error: err.message || 'Failed to get wallet balance' });
    }
  });

  // Initialize storage and cleanup
  ensureStorageDir().then(() => {
    cleanupOldLabels();
    setInterval(cleanupOldLabels, 24 * 60 * 60 * 1000);
  });

  return router;
}
