import express from 'express';
import { logger } from '../lib/logger.js';
import { cropPdfWithPadding } from '../lib/pdf-cropper.js';
import { buyLabel, recoverLabel } from '../lib/purchase.js';

/**
 * Creates the labels router for CRUD and purchase operations.
 * 
 * @param {Object} storage - Label storage instance
 * @param {Object} dhlClient - DHL API client instance
 * @param {Function} getCredentials - Function to get API credentials
 * @returns {express.Router} Labels router
 */
export function createLabelsRouter(storage, dhlClient, getCredentials, print) {
  const router = express.Router();

  /**
   * GET /labels - List all labels
   */
  router.get('/', async (req, res) => {
    try {
      const labels = await storage.getAllLabels();
      res.json(labels);
    } catch (err) {
      logger.error('[Labels] Get error:', err);
      res.status(500).json({ error: 'Failed to get labels' });
    }
  });

  /**
   * GET /labels/:id/pdf - Download a label PDF (with optional 4-direction cropping)
   */
  router.get('/:id/pdf', async (req, res) => {
    try {
      const { print, cropTop, cropRight, cropBottom, cropLeft } = req.query;
      
      const label = await storage.getLabel(req.params.id);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }

      let pdfBuffer = await storage.getLabelPdf(label);

      // Apply 4-direction cropping for print mode
      if (print === '1') {
        try {
          const parseMargin = v => { const n = parseFloat(v); return isNaN(n) ? 5 : n; };
          pdfBuffer = await cropPdfWithPadding(
            pdfBuffer,
            parseMargin(cropTop),
            parseMargin(cropRight),
            parseMargin(cropBottom),
            parseMargin(cropLeft)
          );
          logger.info('[Labels] PDF cropped for printing');
        } catch (err) {
          logger.error('[Labels] Crop failed, sending original:', err.message);
        }
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${label.filename}"`);
      res.send(pdfBuffer);
    } catch (err) {
      logger.error('[Labels] PDF error:', err);
      res.status(500).json({ error: 'Failed to get PDF' });
    }
  });

  /**
   * DELETE /labels/:id - Delete a label
   */
  router.delete('/:id', async (req, res) => {
    try {
      const deleted = await storage.deleteLabel(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Label not found' });
      }
      res.json({ success: true });
    } catch (err) {
      logger.error('[Labels] Delete error:', err);
      res.status(500).json({ error: 'Failed to delete label' });
    }
  });

  // CUPS print with the saved printer settings (settings.json)
  router.post('/:id/print', async (req, res) => {
    try {
      const result = await print(req.params.id);
      if (result.skipped) return res.status(400).json({ error: 'Direct print not configured (CUPS URL, printer name)' });
      if (!result.success) return res.status(result.status || 500).json({ error: result.error });
      res.json(result);
    } catch (err) {
      logger.error('[Print] Error:', err);
      res.status(500).json({ error: err.message || 'Print failed' });
    }
  });

  /**
   * POST /labels/:id/refund - Request a DHL refund for the label's voucher
   */
  router.post('/:id/refund', async (req, res) => {
    try {
      const label = await storage.getLabel(req.params.id);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      if (!label.voucherId) {
        return res.status(400).json({ error: 'Label has no voucher ID' });
      }
      if (label.refund) {
        return res.status(409).json({ error: 'Refund already requested', label });
      }

      const tokenData = await dhlClient.getAccessToken(getCredentials());
      const result = await dhlClient.refundVoucher(tokenData.accessToken, label);

      if (!result.success) {
        logger.warn('[Labels] Refund rejected:', result.status, result.details);
        return res.status(result.status || 500).json({ error: 'Refund failed', details: result.details });
      }

      logger.info(`[Labels] Refund requested for ${label.voucherId}: retoure ${result.retoureTransactionId}`);
      const updated = await storage.updateLabel(label.id, {
        refund: {
          shopRetoureId: result.shopRetoureId,
          retoureTransactionId: result.retoureTransactionId,
          requestedAt: new Date().toISOString()
        }
      });
      res.json({ success: true, label: updated });
    } catch (err) {
      logger.error('[Labels] Refund error:', err);
      res.status(500).json({ error: err.message || 'Failed to request refund' });
    }
  });

  /**
   * POST /labels/purchase - Purchase a label from DHL, download its PDF and store it
   */
  router.post('/purchase', async (req, res) => {
    try {
      const { sender, receiver, productCode, productName, priceInCents, pageFormatId, recipientAddress } = req.body;
      if (!sender || !receiver || !productCode || priceInCents === undefined || !recipientAddress) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const result = await buyLabel({ storage, dhlClient, credentials: getCredentials() },
        { sender, receiver, productCode, productName, priceInCents, pageFormatId, recipientAddress });
      if (!result.success) {
        const { status, ...body } = result;
        return res.status(status).json({ ...body, status });
      }
      res.json(result);
    } catch (err) {
      logger.error('[Labels] Purchase error:', err);
      res.status(500).json({ error: err.message || 'Failed to purchase label' });
    }
  });

  /**
   * POST /labels/recover - Fetch and store the label of an earlier checkout by shopOrderId
   */
  router.post('/recover', async (req, res) => {
    try {
      const { shopOrderId, productCode, productName, recipientAddress } = req.body;
      if (!shopOrderId || !productCode || !recipientAddress) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const result = await recoverLabel({ storage, dhlClient, credentials: getCredentials() },
        { shopOrderId: String(shopOrderId), productCode, productName, recipientAddress });
      if (!result.success) {
        const { status, ...body } = result;
        return res.status(status).json({ ...body, status });
      }
      res.json(result);
    } catch (err) {
      logger.error('[Labels] Recover error:', err);
      res.status(500).json({ error: err.message || 'Failed to retrieve label' });
    }
  });

  return router;
}
