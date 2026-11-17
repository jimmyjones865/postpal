import express from 'express';
import { logger } from '../lib/logger.js';
import { printStoredLabel } from '../lib/print-label.js';

/**
 * Creates the print router for CUPS printing operations.
 *
 * @param {Object} storage - Label storage instance
 * @returns {express.Router} Print router
 */
export function createPrintRouter(storage) {
  const router = express.Router();

  /**
   * POST /print - Send a label to a CUPS printer
   */
  router.post('/print', async (req, res) => {
    try {
      const { labelId, cupsUrl, printerName } = req.body;
      if (!labelId || !cupsUrl || !printerName) {
        return res.status(400).json({
          error: 'Missing required fields: labelId, cupsUrl, printerName'
        });
      }

      const result = await printStoredLabel(storage, labelId, req.body);
      if (!result.success) {
        const { status, ...body } = result;
        return res.status(status).json(body);
      }
      res.json({ ...result, message: `Print job sent to ${printerName}` });
    } catch (err) {
      logger.error('[Print] Error:', err);
      res.status(500).json({ error: err.message || 'Print failed' });
    }
  });

  return router;
}
