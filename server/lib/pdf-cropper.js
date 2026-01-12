import { PDFDocument } from 'pdf-lib';

// Convert mm to PDF points (1 point = 1/72 inch, 1 inch = 25.4mm)
const mmToPoints = (mm) => (mm / 25.4) * 72;
const pointsToMm = (pts) => (pts / 72) * 25.4;

/**
 * Estimates content margins in Deutsche Post labels.
 * Based on analysis of actual labels, the content has approximately:
 * - ~8mm whitespace on left
 * - ~5mm whitespace on right  
 * - ~5mm whitespace on top
 * - ~8mm whitespace on bottom
 * 
 * These are the internal margins of the label that we want to trim.
 */
function getEstimatedContentMargins() {
  return {
    left: mmToPoints(8),
    right: mmToPoints(5),
    top: mmToPoints(5),
    bottom: mmToPoints(8)
  };
}

/**
 * Crops a PDF to remove internal whitespace and apply specified padding.
 * This analyzes the current page size and trims the estimated internal margins,
 * then applies the desired padding around the content.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} paddingHorizontalMm - Horizontal padding to add in mm (left and right)
 * @param {number} paddingVerticalMm - Vertical padding to add in mm (top and bottom)
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function cropPdfCentered(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  const desiredPaddingH = mmToPoints(paddingHorizontalMm);
  const desiredPaddingV = mmToPoints(paddingVerticalMm);
  
  for (const page of pages) {
    const mediaBox = page.getMediaBox();
    const margins = getEstimatedContentMargins();
    
    // Calculate where content actually is within the current page
    // Content starts after left margin and ends before right margin
    const contentX = mediaBox.x + margins.left;
    const contentY = mediaBox.y + margins.bottom;
    const contentWidth = mediaBox.width - margins.left - margins.right;
    const contentHeight = mediaBox.height - margins.top - margins.bottom;
    
    // New page size: content + desired padding on each side
    const newWidth = contentWidth + (desiredPaddingH * 2);
    const newHeight = contentHeight + (desiredPaddingV * 2);
    
    // New crop box starts at content position minus desired padding
    const cropX = contentX - desiredPaddingH;
    const cropY = contentY - desiredPaddingV;
    
    // Clamp to valid bounds
    const finalCropX = Math.max(mediaBox.x, cropX);
    const finalCropY = Math.max(mediaBox.y, cropY);
    const finalWidth = Math.min(newWidth, mediaBox.width - (finalCropX - mediaBox.x));
    const finalHeight = Math.min(newHeight, mediaBox.height - (finalCropY - mediaBox.y));
    
    console.log(`PDF Crop: Original=${pointsToMm(mediaBox.width).toFixed(1)}x${pointsToMm(mediaBox.height).toFixed(1)}mm`);
    console.log(`PDF Crop: Estimated content=${pointsToMm(contentWidth).toFixed(1)}x${pointsToMm(contentHeight).toFixed(1)}mm`);
    console.log(`PDF Crop: New size=${pointsToMm(finalWidth).toFixed(1)}x${pointsToMm(finalHeight).toFixed(1)}mm (padding H=${paddingHorizontalMm}mm, V=${paddingVerticalMm}mm)`);
    
    // Apply cropping - set new page boundaries
    page.setMediaBox(finalCropX, finalCropY, finalWidth, finalHeight);
    page.setCropBox(finalCropX, finalCropY, finalWidth, finalHeight);
    page.setTrimBox(finalCropX, finalCropY, finalWidth, finalHeight);
    
    console.log(`PDF Crop: Applied crop at (${pointsToMm(finalCropX).toFixed(1)}, ${pointsToMm(finalCropY).toFixed(1)})mm`);
  }
  
  const croppedPdfBytes = await pdfDoc.save();
  return Buffer.from(croppedPdfBytes);
}

/**
 * Legacy function - redirects to centered cropping
 * @deprecated Use cropPdfCentered instead
 */
export async function cropPdfWhitespace(pdfBuffer, marginHorizontalMm = 5, marginVerticalMm = 5) {
  return cropPdfCentered(pdfBuffer, marginHorizontalMm, marginVerticalMm);
}

/**
 * Smart crop that attempts to detect content by analyzing typical label patterns.
 * Centers the detected content with equal padding on all sides.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} paddingHorizontalMm - Horizontal padding to keep in mm
 * @param {number} paddingVerticalMm - Vertical padding to keep in mm
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function smartCropPdf(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  return cropPdfCentered(pdfBuffer, paddingHorizontalMm, paddingVerticalMm);
}
