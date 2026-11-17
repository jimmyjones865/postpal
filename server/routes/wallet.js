import express from 'express';
import { logger } from '../lib/logger.js';
import { MIN_TOPUP_CENTS, TOPUP_MAX_CENTS, TOPUP_DAILY_MAX_CENTS, chargeErrorTitle } from '../lib/topups.js';

/**
 * Creates the wallet router for balance operations.
 *
 * @param {Object} dhlClient - DHL API client instance
 * @param {Function} getCredentials - Function to get API credentials
 * @param {Object} topups - shared top-up ledger (lib/topups.js)
 * @returns {express.Router} Wallet router
 */
export function createWalletRouter(dhlClient, getCredentials, topups) {
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
    let sent = false;
    try {
      const { amountCents } = req.body;
      if (!Number.isInteger(amountCents) || amountCents < MIN_TOPUP_CENTS || amountCents > TOPUP_MAX_CENTS) {
        return res.status(400).json({ error: `Amount must be ${MIN_TOPUP_CENTS / 100}–${TOPUP_MAX_CENTS / 100} €` });
      }
      const today = await topups.todayCents();
      if (today + amountCents > TOPUP_DAILY_MAX_CENTS) {
        return res.status(400).json({ error: `Daily top-up max ${TOPUP_DAILY_MAX_CENTS / 100} € (${today / 100} € today)` });
      }

      const tokenData = await dhlClient.getAccessToken(getCredentials());
      sent = true;
      const result = await topups.charge(dhlClient, tokenData.accessToken, amountCents, 'ui');

      if (!result.success) {
        logger.warn('[Wallet] Charge rejected:', result.status, result.details);
        return res.status(result.status || 500).json({ error: chargeErrorTitle(result), details: result.details });
      }

      logger.info(`[Wallet] Charged ${amountCents} ct, new balance ${result.newBalance}`);
      res.json({ success: true, balance: result.newBalance });
    } catch (err) {
      logger.error('[Wallet] Charge error:', err);
      res.status(500).json({ error: sent ? `Top-up outcome unknown: ${err.message} — check Portokasse` : err.message });
    }
  });

  return router;
}
