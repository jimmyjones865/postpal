import { logger } from './logger.js';
import { cropPdfWithPaddingAndDimensions, rotatePdf } from './pdf-cropper.js';
import { sendToCups } from './cups-printer.js';

// DHL Paket (MOPS) labels need more room than letters at the same settings; added in printed orientation
const PAKET_EXTRA_MM = { top: 2, bottom: 3 };

/**
 * Crops, sizes, rotates and sends a stored label to CUPS. Shared by POST /print and the email intake.
 * Returns { success, jobId, mediaDimensions } or { success: false, status, error, details? }.
 */
export async function printStoredLabel(storage, labelId, {
  cupsUrl, printerName, orientation,
  cropTop, cropRight, cropBottom, cropLeft,
  disableCropping,
  paperWidthMm, paperHeightMm, endlessRoll
}) {
  // Load the label
  const label = await storage.getLabel(labelId);
  if (!label) {
    return { success: false, status: 404, error: 'Label not found' };
  }
  
  // Read original PDF
  let pdfBuffer = await storage.getLabelPdf(label);
  
  const parseMargin = v => { const n = parseFloat(v); return isNaN(n) ? 5 : n; };

  // Parse 4-direction crop margins as the user intends them (relative to printed orientation)
  const extra = label.provider === 'dhl-paket' ? PAKET_EXTRA_MM : { top: 0, bottom: 0 };
  const marginTop = parseMargin(cropTop) + extra.top;
  const marginRight = parseMargin(cropRight);
  const marginBottom = parseMargin(cropBottom) + extra.bottom;
  const marginLeft = parseMargin(cropLeft);
  const isLandscape = orientation === 'landscape';

  // For landscape, the PDF is rotated 90° CW after cropping, so margins must be remapped
  // to portrait space so they land on the correct edges after rotation:
  //   portrait-left → landscape-top, portrait-top → landscape-right,
  //   portrait-right → landscape-bottom, portrait-bottom → landscape-left
  const cropT = isLandscape ? marginRight : marginTop;
  const cropR = isLandscape ? marginBottom : marginRight;
  const cropB = isLandscape ? marginLeft : marginBottom;
  const cropL = isLandscape ? marginTop : marginLeft;

  // Crop PDF and get dimensions in a single operation (avoids duplicate pixel scanning)
  let croppedDimensions = null;

  if (!disableCropping) {
    try {
      const cropResult = await cropPdfWithPaddingAndDimensions(
        pdfBuffer,
        cropT, cropR, cropB, cropL
      );
      pdfBuffer = cropResult.buffer;
      croppedDimensions = cropResult.dimensions;
      
      if (cropResult.fallback) {
        logger.info(`[Print] Content detection failed, keeping original size: ${croppedDimensions.original.widthMm}x${croppedDimensions.original.heightMm}mm`);
      } else {
        logger.info(`[Print] PDF cropped to ${croppedDimensions.cropped.widthMm}x${croppedDimensions.cropped.heightMm}mm (T:${marginTop}/R:${marginRight}/B:${marginBottom}/L:${marginLeft}mm)`);
      }
    } catch (cropErr) {
      logger.error('[Print] Crop failed:', cropErr.message);
      
      // For endless roll, cropping is mandatory to determine height
      if (endlessRoll) {
        return {
          success: false,
          status: 500,
          error: 'PDF cropping failed',
          details: 'Cropping is required for endless roll to determine paper height. ' + cropErr.message
        };
      }
      logger.info('[Print] Using explicit paper dimensions (crop failed)');
    }
  } else {
    logger.info('[Print] Cropping disabled, using explicit paper dimensions');
  }
  
  // Calculate media dimensions
  const rollWidthMm = paperWidthMm || 62;
  let mediaWidthMm, mediaHeightMm;

  if (endlessRoll) {
    // Height comes from content: cropped → original page (detection failed) → explicit/default
    const content = croppedDimensions?.cropped
      ?? croppedDimensions?.original
      ?? { widthMm: rollWidthMm, heightMm: paperHeightMm || 100 };
    if (!croppedDimensions?.cropped) {
      logger.info(`[Print] Using fallback content size: ${content.widthMm}x${content.heightMm}mm`);
    }

    // Landscape is rotated 90° after cropping, so content width runs along the roll
    mediaWidthMm = rollWidthMm;
    mediaHeightMm = isLandscape ? content.widthMm : content.heightMm;

    logger.info(`[Print] Endless roll ${isLandscape ? 'landscape' : 'portrait'}: width=${mediaWidthMm}mm, height=${mediaHeightMm.toFixed(1)}mm`);
  } else {
    const fixedHeight = paperHeightMm || 100;
    mediaWidthMm = isLandscape ? fixedHeight : rollWidthMm;
    mediaHeightMm = isLandscape ? rollWidthMm : fixedHeight;

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

  if (!printResult.success) {
    logger.error('[Print] Print failed:', printResult.error);
    return { success: false, status: 500, error: printResult.error || 'Failed to send print job' };
  }
  logger.info(`[Print] Job sent to ${printerName}, job ID: ${printResult.jobId}`);
  return { success: true, jobId: printResult.jobId, mediaDimensions: { widthMm: mediaWidthMm, heightMm: mediaHeightMm } };
}

/** Prints with the shared UI/intake printer settings. { skipped: true } when direct print is off or unconfigured. */
export function printWithSettings(storage, settings, labelId) {
  const printer = settings.get().printerConfig;
  if (!printer.enableDirectPrint || !printer.cupsUrl || !printer.printerName) return Promise.resolve({ skipped: true });
  return printStoredLabel(storage, labelId, {
    cupsUrl: printer.cupsUrl,
    printerName: printer.printerName,
    orientation: printer.orientation,
    cropTop: printer.cropMarginTop,
    cropRight: printer.cropMarginRight,
    cropBottom: printer.cropMarginBottom,
    cropLeft: printer.cropMarginLeft,
    disableCropping: printer.disableCropping,
    paperWidthMm: printer.paperWidthMm,
    paperHeightMm: printer.paperHeightMm,
    endlessRoll: printer.endlessRoll
  });
}
