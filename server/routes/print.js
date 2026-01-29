import express from 'express';
import { logger } from '../lib/logger.js';
import { cropPdfWithPaddingAndDimensions, rotatePdf, getContentDimensions } from '../lib/pdf-cropper.js';
import { sendToCups } from '../lib/cups-printer.js';

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
      const { 
        labelId, cupsUrl, printerName, orientation, 
        cropTop, cropRight, cropBottom, cropLeft,
        disableCropping,
        paperWidthMm, paperHeightMm, endlessRoll
      } = req.body;
      
      if (!labelId || !cupsUrl || !printerName) {
        return res.status(400).json({ 
          error: 'Missing required fields: labelId, cupsUrl, printerName' 
        });
      }
      
      // Load the label
      const label = await storage.getLabel(labelId);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      // Read original PDF
      let pdfBuffer = await storage.getLabelPdf(labelId);
      
      // Parse 4-direction crop margins (default to 5mm each)
      const marginTop = parseFloat(cropTop) || 5;
      const marginRight = parseFloat(cropRight) || 5;
      const marginBottom = parseFloat(cropBottom) || 5;
      const marginLeft = parseFloat(cropLeft) || 5;
      const isLandscape = orientation === 'landscape';
      
      // Crop PDF and get dimensions in a single operation (avoids duplicate pixel scanning)
      let croppedDimensions = null;
      let cropFailed = false;
      
      if (!disableCropping) {
        try {
          const cropResult = await cropPdfWithPaddingAndDimensions(
            pdfBuffer, 
            marginTop, marginRight, marginBottom, marginLeft
          );
          pdfBuffer = cropResult.buffer;
          croppedDimensions = cropResult.dimensions;
          cropFailed = cropResult.fallback;
          
          if (cropResult.fallback) {
            logger.info(`[Print] Content detection failed, keeping original size: ${croppedDimensions.original.widthMm}x${croppedDimensions.original.heightMm}mm`);
          } else {
            logger.info(`[Print] PDF cropped to ${croppedDimensions.cropped.widthMm}x${croppedDimensions.cropped.heightMm}mm (T:${marginTop}/R:${marginRight}/B:${marginBottom}/L:${marginLeft}mm)`);
          }
        } catch (cropErr) {
          logger.error('[Print] Crop failed:', cropErr.message);
          cropFailed = true;
          
          // For endless roll, cropping is mandatory to determine height
          if (endlessRoll) {
            return res.status(500).json({ 
              error: 'PDF cropping failed',
              details: 'Cropping is required for endless roll to determine paper height. ' + cropErr.message
            });
          }
          logger.info('[Print] Using explicit paper dimensions (crop failed)');
        }
      } else {
        logger.info('[Print] Cropping disabled, using explicit paper dimensions');
      }
      
      // Calculate media dimensions
      let mediaWidthMm, mediaHeightMm;
      
      if (endlessRoll) {
        // For endless roll, we need cropped dimensions - if detection failed, use original or explicit
        let contentWidth, contentHeight;
        
        if (croppedDimensions?.cropped) {
          contentWidth = croppedDimensions.cropped.widthMm;
          contentHeight = croppedDimensions.cropped.heightMm;
        } else if (croppedDimensions?.original) {
          // Use original PDF dimensions when detection failed (preferred fallback for endless roll)
          contentWidth = croppedDimensions.original.widthMm;
          contentHeight = croppedDimensions.original.heightMm;
          logger.info(`[Print] Using original PDF dimensions: ${contentWidth}x${contentHeight}mm`);
        } else {
          // Final fallback to explicit paper dimensions or defaults
          contentWidth = paperWidthMm || 62;
          contentHeight = paperHeightMm || 100;
          logger.info(`[Print] Using fallback dimensions: ${contentWidth}x${contentHeight}mm`);
        }
        
        if (isLandscape) {
          mediaWidthMm = paperWidthMm || 62;
          mediaHeightMm = contentWidth;
        } else {
          mediaWidthMm = paperWidthMm || 62;
          mediaHeightMm = contentHeight;
        }
        
        logger.info(`[Print] Endless roll ${isLandscape ? 'landscape' : 'portrait'}: width=${mediaWidthMm}mm, height=${mediaHeightMm.toFixed(1)}mm`);
      } else {
        const fixedWidth = paperWidthMm || 62;
        const fixedHeight = paperHeightMm || 100;
        
        if (isLandscape) {
          mediaWidthMm = fixedHeight;
          mediaHeightMm = fixedWidth;
        } else {
          mediaWidthMm = fixedWidth;
          mediaHeightMm = fixedHeight;
        }
        
        logger.info(`[Print] Fixed paper ${isLandscape ? 'landscape' : 'portrait'}: ${mediaWidthMm}x${mediaHeightMm}mm`);
      }
      
      // Rotate PDF if landscape
      if (isLandscape) {
        try {
          pdfBuffer = await rotatePdf(pdfBuffer, 90);
          logger.info('[Print] PDF rotated 90° for landscape');
        } catch (rotateErr) {
          logger.error('[Print] Rotation failed:', rotateErr.message);
        }
      }
      
      // Send to CUPS with explicit dimensions
      const printResult = await sendToCups(pdfBuffer, cupsUrl, printerName, {
        jobName: `Label ${label.id}`,
        mediaWidthMm,
        mediaHeightMm
      });
      
      if (printResult.success) {
        logger.info(`[Print] Job sent to ${printerName}, job ID: ${printResult.jobId}`);
        res.json({ 
          success: true, 
          jobId: printResult.jobId,
          message: `Print job sent to ${printerName}`,
          mediaDimensions: { widthMm: mediaWidthMm, heightMm: mediaHeightMm }
        });
      } else {
        logger.error('[Print] Print failed:', printResult.error);
        res.status(500).json({ 
          success: false, 
          error: printResult.error || 'Failed to send print job'
        });
      }
    } catch (err) {
      logger.error('[Print] Error:', err);
      res.status(500).json({ error: err.message || 'Print failed' });
    }
  });

  /**
   * POST /labels/:id/dimensions - Get cropped dimensions for a label
   */
  router.post('/labels/:id/dimensions', async (req, res) => {
    try {
      const { cropTop, cropRight, cropBottom, cropLeft, disableCropping } = req.body;
      
      const label = await storage.getLabel(req.params.id);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      const pdfBuffer = await storage.getLabelPdf(req.params.id);
      
      const dimensions = await getContentDimensions(
        pdfBuffer,
        parseFloat(cropTop) || 5,
        parseFloat(cropRight) || 5,
        parseFloat(cropBottom) || 5,
        parseFloat(cropLeft) || 5
      );
      
      res.json({
        original: dimensions.original,
        cropped: disableCropping ? null : dimensions.cropped
      });
    } catch (err) {
      logger.error('[Dimensions] Error:', err);
      res.status(500).json({ error: 'Failed to calculate dimensions' });
    }
  });

  return router;
}
