import express from 'express';
import { logger } from '../lib/logger.js';
import { loadServerConfig } from '../lib/config.js';
import { parseAddress } from '../lib/european-address-parser.js';
import { createLabelStorage } from '../lib/label-storage.js';
import { createDhlClient } from '../lib/dhl-api.js';
import { createLabelsRouter } from './labels.js';
import { createPrintRouter } from './print.js';
import { createWalletRouter } from './wallet.js';

/**
 * Creates the main API router with all sub-routes.
 * 
 * @returns {express.Router} Configured API router
 */
export function createApiRouter() {
  const router = express.Router();

  // Configuration from environment
  const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || '/data/labels';
  const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60', 10);

  // Initialize shared services
  const storage = createLabelStorage(PDF_STORAGE_PATH);
  const dhlClient = createDhlClient();

  /**
   * Gets API credentials from environment variables.
   */
  function getCredentials() {
    return {
      apiKey: process.env.DHL_API_KEY,
      apiSecret: process.env.DHL_API_SECRET,
      portokasseLogin: process.env.DHL_PORTOKASSE_LOGIN,
      portokassePassword: process.env.DHL_PORTOKASSE_PASSWORD
    };
  }

  /* ==================== Mount sub-routers ==================== */

  // Labels: CRUD + purchase
  router.use('/labels', createLabelsRouter(storage, dhlClient, getCredentials));

  // Print: CUPS printing + dimensions
  router.use('/', createPrintRouter(storage));

  // Wallet: balance operations
  router.use('/wallet', createWalletRouter(dhlClient, getCredentials));

  /* ==================== Simple routes (kept here) ==================== */

  /**
   * GET /health - Health check endpoint
   */
  router.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      storagePath: PDF_STORAGE_PATH, 
      retentionDays: RETENTION_DAYS 
    });
  });

  /**
   * GET /credentials/status - Check if API credentials are configured
   */
  router.get('/credentials/status', (req, res) => {
    const creds = getCredentials();
    const configured = Boolean(
      creds.apiKey && 
      creds.apiSecret && 
      creds.portokasseLogin && 
      creds.portokassePassword
    );
    res.json({ configured });
  });

  /**
   * GET /config - Frontend configuration (language, etc.)
   */
  router.get('/config', (req, res) => {
    res.json({ language: process.env.LANGUAGE || 'de' });
  });

  /**
   * GET /config/defaults - Get server-side configuration defaults
   * Returns any sender address or printer settings configured via environment variables.
   * Client (localStorage) takes precedence but can see what server provides.
   */
  router.get('/config/defaults', (req, res) => {
    res.json(loadServerConfig());
  });

  /**
   * POST /parse-address - Parse a raw address string
   */
  router.post('/parse-address', (req, res) => {
    try {
      const { address } = req.body;
      if (!address || typeof address !== 'string') {
        return res.status(400).json({ error: 'Missing address field' });
      }

      logger.debug('[ParseAddress] Input:', address);
      const result = parseAddress(address);
      logger.debug('[ParseAddress] Parsed:', JSON.stringify(result));

      res.json(result);
    } catch (err) {
      logger.error('[ParseAddress] Error:', err);
      res.status(500).json({ error: 'Failed to parse address' });
    }
  });

  /**
   * GET /proxy-pdf - Proxy PDF downloads from DHL
   */
  router.get('/proxy-pdf', async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
      }
      if (!url.startsWith('https://internetmarke.deutschepost.de/')) {
        return res.status(403).json({ error: 'Only DHL URLs allowed' });
      }

      logger.debug('[ProxyPDF] Fetching:', url);
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch PDF' });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="label.pdf"');
      res.send(buffer);
    } catch (err) {
      logger.error('[ProxyPDF] Error:', err);
      res.status(500).json({ error: 'Failed to proxy PDF' });
    }
  });

  /* ==================== Initialize storage and cleanup ==================== */

  storage.ensureDir().then(() => {
    storage.cleanupOldLabels(RETENTION_DAYS);
    // Schedule daily cleanup
    setInterval(() => storage.cleanupOldLabels(RETENTION_DAYS), 24 * 60 * 60 * 1000);
  });

  return router;
}
