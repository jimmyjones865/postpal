import express from 'express';
import { cropPdfWithPadding, rotatePdf, getContentDimensions } from '../lib/pdf-cropper.js';
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
        cropH, cropV, disableCropping,
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
      
      const cropMarginH = parseFloat(cropH) || 5;
      const cropMarginV = parseFloat(cropV) || 5;
      const isLandscape = orientation === 'landscape';
      
      // Get cropped dimensions and crop PDF
      let croppedDimensions = null;
      
      if (!disableCropping) {
        try {
          croppedDimensions = await getContentDimensions(pdfBuffer, cropMarginH, cropMarginV);
          pdfBuffer = await cropPdfWithPadding(pdfBuffer, cropMarginH, cropMarginV);
          console.log(`[Print] PDF cropped to ${croppedDimensions.cropped.widthMm}x${croppedDimensions.cropped.heightMm}mm`);
        } catch (cropErr) {
          console.error('[Print] Crop failed:', cropErr.message);
          
          // For endless roll, cropping is mandatory to determine height
          if (endlessRoll) {
            return res.status(500).json({ 
              error: 'PDF cropping failed',
              details: 'Cropping is required for endless roll to determine paper height. ' + cropErr.message
            });
          }
          console.log('[Print] Using explicit paper dimensions (crop failed)');
        }
      } else {
        console.log('[Print] Cropping disabled, using explicit paper dimensions');
      }
      
      // Calculate media dimensions
      let mediaWidthMm, mediaHeightMm;
      
      if (endlessRoll) {
        const contentWidth = croppedDimensions?.cropped?.widthMm || paperWidthMm || 62;
        const contentHeight = croppedDimensions?.cropped?.heightMm || 40;
        
        if (isLandscape) {
          mediaWidthMm = paperWidthMm || 62;
          mediaHeightMm = contentWidth;
        } else {
          mediaWidthMm = paperWidthMm || 62;
          mediaHeightMm = contentHeight;
        }
        
        console.log(`[Print] Endless roll ${isLandscape ? 'landscape' : 'portrait'}: width=${mediaWidthMm}mm, height=${mediaHeightMm.toFixed(1)}mm`);
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
        
        console.log(`[Print] Fixed paper ${isLandscape ? 'landscape' : 'portrait'}: ${mediaWidthMm}x${mediaHeightMm}mm`);
      }
      
      // Rotate PDF if landscape
      if (isLandscape) {
        try {
          pdfBuffer = await rotatePdf(pdfBuffer, 90);
          console.log('[Print] PDF rotated 90° for landscape');
        } catch (rotateErr) {
          console.error('[Print] Rotation failed:', rotateErr.message);
        }
      }
      
      // Send to CUPS with explicit dimensions
      const printResult = await sendToCups(pdfBuffer, cupsUrl, printerName, {
        jobName: `Label ${label.id}`,
        mediaWidthMm,
        mediaHeightMm
      });
      
      if (printResult.success) {
        console.log(`[Print] Job sent to ${printerName}, job ID: ${printResult.jobId}`);
        res.json({ 
          success: true, 
          jobId: printResult.jobId,
          message: `Print job sent to ${printerName}`,
          mediaDimensions: { widthMm: mediaWidthMm, heightMm: mediaHeightMm }
        });
      } else {
        console.error('[Print] Print failed:', printResult.error);
        res.status(500).json({ 
          success: false, 
          error: printResult.error || 'Failed to send print job'
        });
      }
    } catch (err) {
      console.error('[Print] Error:', err);
      res.status(500).json({ error: err.message || 'Print failed' });
    }
  });

  /**
   * POST /labels/:id/dimensions - Get cropped dimensions for a label
   */
  router.post('/labels/:id/dimensions', async (req, res) => {
    try {
      const { cropH, cropV, disableCropping } = req.body;
      
      const label = await storage.getLabel(req.params.id);
      if (!label) {
        return res.status(404).json({ error: 'Label not found' });
      }
      
      const pdfBuffer = await storage.getLabelPdf(req.params.id);
      
      const dimensions = await getContentDimensions(
        pdfBuffer,
        parseFloat(cropH) || 5,
        parseFloat(cropV) || 5
      );
      
      res.json({
        original: dimensions.original,
        cropped: disableCropping ? null : dimensions.cropped
      });
    } catch (err) {
      console.error('[Dimensions] Error:', err);
      res.status(500).json({ error: 'Failed to calculate dimensions' });
    }
  });

  return router;
}
