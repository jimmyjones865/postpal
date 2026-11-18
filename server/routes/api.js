import express from 'express';
import { logger } from '../lib/logger.js';
import { createSettingsStore } from '../lib/settings.js';
import { parseAddress } from '../lib/european-address-parser.js';
import { createLabelStorage } from '../lib/label-storage.js';
import { createDhlClient } from '../lib/dhl-api.js';
import { createLabelsRouter } from './labels.js';
import { createWalletRouter } from './wallet.js';
import { startCmIntake } from '../lib/cm-intake.js';
import { createTopupLedger } from '../lib/topups.js';
import { createPakClient, pakConfigFromEnv } from '../lib/dhl-private-api.js';
import { createPaketService } from '../lib/paket.js';
import { createPaketRouter } from './paket.js';
import { createIntakeRouter } from './intake.js';
import { notify } from '../lib/discord.js';
import { printWithSettings } from '../lib/print-label.js';

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
  const topups = createTopupLedger(PDF_STORAGE_PATH);
  const settings = createSettingsStore(PDF_STORAGE_PATH);
  const print = labelId => printWithSettings(storage, settings, labelId);
  const paket = createPaketService({
    storage,
    settings,
    pakClient: createPakClient(pakConfigFromEnv()),
    storagePath: PDF_STORAGE_PATH,
    // Base for /pay links in Discord + the cart tag; must be the URL Carl opens postpal at
    publicUrl: (process.env.POSTPAL_URL || 'http://localhost:3001').replace(/\/$/, ''),
    localUrl: process.env.POSTPAL_LOCAL_URL?.replace(/\/$/, '') || undefined,
    confirmEmail: process.env.DHL_PAKET_EMAIL,
    notify,
    print
  });

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
  router.use('/labels', createLabelsRouter(storage, dhlClient, getCredentials, print));

  router.use('/paket', createPaketRouter(paket));
  router.use('/intake', createIntakeRouter({ storagePath: PDF_STORAGE_PATH, storage, paket, settings }));

  // Wallet: balance operations
  router.use('/wallet', createWalletRouter(dhlClient, getCredentials, topups));

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
   * GET /settings - effective settings, env/code defaults, and the stored overrides
   * PATCH /settings - { section: { key: value | null } }; null = back to env
   */
  const intakeEnabled = Boolean(process.env.MAIL_SERVER && process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD);
  const settingsBody = () => ({ settings: settings.get(), defaults: settings.defaults(), stored: settings.stored(), intakeEnabled });
  router.get('/settings', (req, res) => res.json(settingsBody()));
  router.patch('/settings', async (req, res) => {
    try {
      await settings.update(req.body || {});
      res.json(settingsBody());
    } catch (err) {
      if (err.status !== 400) logger.error('[Settings] Save failed:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
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

  /* ==================== Initialize storage and cleanup ==================== */

  storage.ensureDir().then(() => {
    storage.cleanupOldLabels(RETENTION_DAYS);
    // Schedule daily cleanup
    setInterval(() => storage.cleanupOldLabels(RETENTION_DAYS), 24 * 60 * 60 * 1000);
    startCmIntake({ storage, dhlClient, getCredentials, topups, settings, storagePath: PDF_STORAGE_PATH, paket });
  });

  return router;
}
