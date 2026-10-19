import express from 'express';
import { logger } from '../lib/logger.js';
import { cropPdfWithPadding } from '../lib/pdf-cropper.js';

const DHL_PDF_ORIGIN = 'https://internetmarke.deutschepost.de/';

/**
 * Creates the labels router for CRUD and purchase operations.
 * 
 * @param {Object} storage - Label storage instance
 * @param {Object} dhlClient - DHL API client instance
 * @param {Function} getCredentials - Function to get API credentials
 * @returns {express.Router} Labels router
 */
export function createLabelsRouter(storage, dhlClient, getCredentials) {
  const router = express.Router();

  async function fetchDhlPdf(url) {
    if (!url?.startsWith(DHL_PDF_ORIGIN)) {
      throw new Error(`Unexpected PDF URL: ${url}`);
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`PDF download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

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

  /**
   * POST /labels/purchase - Purchase a label from DHL, download its PDF and store it
   */
  router.post('/purchase', async (req, res) => {
    try {
      const { sender, receiver, productCode, productName, priceInCents, pageFormatId, recipientAddress } = req.body;
      const credentials = getCredentials();

      if (!sender || !receiver || !productCode || priceInCents === undefined || !recipientAddress) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const tokenData = await dhlClient.getAccessToken(credentials);

      const payload = dhlClient.buildPurchasePayload({
        sender,
        receiver,
        productCode,
        priceInCents,
        pageFormatId: parseInt(pageFormatId)
      });

      const result = await dhlClient.purchaseLabel(tokenData.accessToken, payload);

      if (!result.success) {
        return res.status(result.status || 500).json({ 
          error: result.error, 
          details: result.details,
          status: result.status 
        });
      }

      // From here on the label is paid for — any failure must surface the DHL link
      let label;
      try {
        label = await storage.saveLabel(await fetchDhlPdf(result.pdfUrl), {
          recipientAddress,
          productCode,
          productName: productName || productCode,
          voucherId: result.voucherId,
          trackId: result.trackId
        });
      } catch (err) {
        logger.error('[Labels] Purchased but could not store PDF:', err.message, result.pdfUrl);
        return res.status(502).json({
          error: 'Label purchased, but the PDF could not be stored',
          details: `${err.message}. PDF: ${result.pdfUrl}`,
          paid: true,
          newBalance: result.newBalance
        });
      }

      res.json({ success: true, label, newBalance: result.newBalance });
    } catch (err) {
      logger.error('[Labels] Purchase error:', err);
      res.status(500).json({ error: err.message || 'Failed to purchase label' });
    }
  });

  return router;
}
