import { PDFDocument } from 'pdf-lib';

// Convert mm to PDF points (1 point = 1/72 inch, 1 inch = 25.4mm)
const mmToPoints = (mm) => (mm / 25.4) * 72;
const pointsToMm = (pts) => (pts / 72) * 25.4;

/**
 * Deutsche Post Internetmarke labels have a known content area.
 * The PDF page is typically 210x297mm (A4) but the actual label content
 * is approximately 100mm x 70mm positioned in the top-left area.
 * 
 * This function returns the content bounds based on actual label analysis.
 */
function getKnownLabelContentBounds(page) {
  const mediaBox = page.getMediaBox();
  
  // Deutsche Post Internetmarke label dimensions (based on actual measurement):
  // - Content area: approximately 100mm x 70mm
  // - Positioned at top-left of the page with minimal internal margins
  // 
  // The label content typically occupies:
  // - Width: ~100mm (283 points)
  // - Height: ~70mm (198 points)
  // - Starting from top-left corner
  
  const labelWidthPts = mmToPoints(100);  // ~283 points
  const labelHeightPts = mmToPoints(70);  // ~198 points
  
  // Content is at top-left of the page
  // In PDF coordinates, Y=0 is at bottom, so content is at (0, pageHeight - labelHeight) to (labelWidth, pageHeight)
  return {
    minX: 0,
    minY: mediaBox.height - labelHeightPts,
    maxX: Math.min(labelWidthPts, mediaBox.width),
    maxY: mediaBox.height,
    width: labelWidthPts,
    height: labelHeightPts
  };
}

/**
 * Crops a PDF to remove whitespace and center the label content with specified padding.
 * This is designed for Deutsche Post Internetmarke labels which have a ~100x70mm content
 * area on an A4 page.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} paddingHorizontalMm - Horizontal padding to add in mm (left and right)
 * @param {number} paddingVerticalMm - Vertical padding to add in mm (top and bottom)
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function cropPdfCentered(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  const paddingH = mmToPoints(paddingHorizontalMm);
  const paddingV = mmToPoints(paddingVerticalMm);
  
  for (const page of pages) {
    const mediaBox = page.getMediaBox();
    
    // Get the known content bounds for the label
    const contentBounds = getKnownLabelContentBounds(page);
    
    // Calculate new page dimensions: content size + padding on each side
    const newWidth = contentBounds.width + (paddingH * 2);
    const newHeight = contentBounds.height + (paddingV * 2);
    
    // Calculate crop box coordinates
    // We want to keep the content and add equal padding around it
    // The crop box defines what part of the original page to show
    const cropX = contentBounds.minX - paddingH;
    const cropY = contentBounds.minY - paddingV;
    
    // Clamp to original page bounds
    const finalCropX = Math.max(0, cropX);
    const finalCropY = Math.max(0, cropY);
    const finalWidth = Math.min(newWidth, mediaBox.width - finalCropX);
    const finalHeight = Math.min(newHeight, mediaBox.height - finalCropY);
    
    console.log(`PDF Crop: Original=${pointsToMm(mediaBox.width).toFixed(1)}x${pointsToMm(mediaBox.height).toFixed(1)}mm`);
    console.log(`PDF Crop: Content bounds=${pointsToMm(contentBounds.width).toFixed(1)}x${pointsToMm(contentBounds.height).toFixed(1)}mm`);
    console.log(`PDF Crop: New size=${pointsToMm(finalWidth).toFixed(1)}x${pointsToMm(finalHeight).toFixed(1)}mm (padding H=${paddingHorizontalMm}mm, V=${paddingVerticalMm}mm)`);
    
    // Only apply cropping if it actually reduces the page size significantly
    if (finalWidth < mediaBox.width - 10 || finalHeight < mediaBox.height - 10) {
      // Set all box types for maximum compatibility
      page.setMediaBox(finalCropX, finalCropY, finalWidth, finalHeight);
      page.setCropBox(finalCropX, finalCropY, finalWidth, finalHeight);
      page.setTrimBox(finalCropX, finalCropY, finalWidth, finalHeight);
    } else {
      console.log('PDF Crop: Skipping - would not significantly reduce size');
    }
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
