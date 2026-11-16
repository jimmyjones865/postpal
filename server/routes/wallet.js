import express from 'express';
import { logger } from '../lib/logger.js';

const MIN_TOPUP_CENTS = 1000; // DHL minimum; below it DHL answers quotaExceeded
const MAX_TOPUP_CENTS = Math.round(parseFloat(process.env.TOPUP_MAX_EUR || '50') * 100);

/**
 * Creates the wallet router for balance operations.
 * 
 * @param {Object} dhlClient - DHL API client instance
 * @param {Function} getCredentials - Function to get API credentials
 * @returns {express.Router} Wallet router
 */
export function createWalletRouter(dhlClient, getCredentials) {
  const router = express.Router();

  /**
   * POST /wallet/balance - Get current wallet balance (forces token refresh)
   */
  router.post('/balance', async (req, res) => {
    try {
      const credentials = getCredentials();
      
      if (!credentials.apiKey) {
        return res.status(400).json({ error: 'Missing credentials' });
      }

      const tokenData = await dhlClient.getAccessToken(credentials, true);
      
      res.json({ 
        balance: tokenData.walletBalance, 
        expiresAt: tokenData.expiresAt 
      });
    } catch (err) {
      logger.error('[Wallet] Balance error:', err);
      res.status(500).json({ error: err.message || 'Failed to get wallet balance' });
    }
  });

  /**
   * POST /wallet/charge - Top up the Portokasse by amountCents
   */
  router.post('/charge', async (req, res) => {
    try {
      const { amountCents } = req.body;
      if (!Number.isInteger(amountCents) || amountCents < MIN_TOPUP_CENTS || amountCents > MAX_TOPUP_CENTS) {
        return res.status(400).json({ error: `Amount must be ${MIN_TOPUP_CENTS / 100}–${MAX_TOPUP_CENTS / 100} €` });
      }

      const tokenData = await dhlClient.getAccessToken(getCredentials());
      const result = await dhlClient.chargeWallet(tokenData.accessToken, amountCents);

      if (!result.success) {
        logger.warn('[Wallet] Charge rejected:', result.status, result.details);
        let title;
        try { title = JSON.parse(result.details).title; } catch { /* non-JSON body */ }
        return res.status(result.status || 500).json({ error: title || 'Top-up failed', details: result.details });
      }

      logger.info(`[Wallet] Charged ${amountCents} ct, new balance ${result.newBalance}`);
      res.json({ success: true, balance: result.newBalance });
    } catch (err) {
      logger.error('[Wallet] Charge error:', err);
      res.status(500).json({ error: err.message || 'Top-up failed' });
    }
  });

  return router;
}
