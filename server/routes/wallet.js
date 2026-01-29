import express from 'express';
import { logger } from '../lib/logger.js';

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

  return router;
}
