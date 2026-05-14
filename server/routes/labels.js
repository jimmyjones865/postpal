import express from 'express';
import { logger } from '../lib/logger.js';
import { cropPdfWithPadding, renderPdfToImage } from '../lib/pdf-cropper.js';

/**
 * Creates the labels router for CRUD and purchase operations.
 * 
 * @param {Object} storage - Label storage instance
 * @param {Object} dhlClient - DHL API client instance
 * @param {Function} getPageFormatIdByName - Paper format lookup function
 * @param {Function} getCredentials - Function to get API credentials
 * @returns {express.Router} Labels router
 */
export function createLabelsRouter(storage, dhlClient, getCredentials) {
  const router = express.Router();

  /**
   * POST /labels - Save a new label
   */
  router.post('/', async (req, res) => {
    try {
      const { pdfBase64, recipientAddress, productCode, productName, voucherId, trackId } = req.body;

      if (!pdfBase64 || !recipientAddress || !productCode) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const labelInfo = await storage.saveLabel(pdfBase64, {
        recipientAddress,
        productCode,
        productName,
        voucherId: voucherId || null,
        trackId: trackId || null
      });

      res.json({ success: true, label: labelInfo });
    } catch (err) {
      logger.error('[Labels] Save error:', err);
      res.status(500).json({ error: 'Failed to save label' });
    }
  });

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

      let pdfBuffer = await storage.getLabelPdf(req.params.id);

      // Apply 4-direction cropping for print mode
      if (print === '1') {
        try {
          pdfBuffer = await cropPdfWithPadding(
            pdfBuffer, 
            parseFloat(cropTop) || 5,
            parseFloat(cropRight) || 5,
            parseFloat(cropBottom) || 5,
            parseFloat(cropLeft) || 5
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
   * GET /labels/:id/image - Get label as a rendered PNG image (for preview)
   */
  router.get('/:id/image', async (req, res) => {
    try {
      const label = await storage.getLabel(req.params.id);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }

      const pdfBuffer = await storage.getLabelPdf(req.params.id);
      const imageBuffer = await renderPdfToImage(pdfBuffer);

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(imageBuffer);
    } catch (err) {
      logger.error('[Labels] Image render error:', err);
      res.status(500).json({ error: 'Failed to render label image' });
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
   * POST /labels/purchase - Purchase a new label from DHL
   */
  router.post('/purchase', async (req, res) => {
    try {
      const { sender, receiver, productCode, priceInCents, pageFormatId } = req.body;
      const credentials = getCredentials();

      if (!sender || !receiver || !productCode || priceInCents === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const tokenData = await dhlClient.getAccessToken(credentials);
      const formatId = parseInt(pageFormatId) || 176;

      const payload = dhlClient.buildPurchasePayload({
        sender,
        receiver,
        productCode,
        priceInCents,
        pageFormatId: formatId
      });

      const result = await dhlClient.purchaseLabel(tokenData.accessToken, payload);

      if (!result.success) {
        return res.status(result.status || 500).json({ 
          error: result.error, 
          details: result.details,
          status: result.status 
        });
      }

      res.json(result);
    } catch (err) {
      logger.error('[Labels] Purchase error:', err);
      res.status(500).json({ error: err.message || 'Failed to purchase label' });
    }
  });

  return router;
}
