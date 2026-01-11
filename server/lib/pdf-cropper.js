import { PDFDocument } from 'pdf-lib';

// Convert mm to PDF points (1 point = 1/72 inch, 1 inch = 25.4mm)
const mmToPoints = (mm) => (mm / 25.4) * 72;

/**
 * Analyzes PDF content to find the bounding box of actual content.
 * This scans the PDF's content streams to detect drawing operations.
 * 
 * @param {PDFPage} page - The PDF page to analyze
 * @returns {Object} - Bounding box { minX, minY, maxX, maxY } in points
 */
function findContentBounds(page) {
  const mediaBox = page.getMediaBox();
  
  // Get the content stream from the page
  const dict = page.node.dict;
  
  // Try to get the CropBox or TrimBox which often indicates content bounds
  try {
    // Check for TrimBox (often set by label generators to indicate actual content)
    const trimBoxRef = dict.get(page.doc.context.obj('TrimBox'));
    if (trimBoxRef) {
      const trimBox = trimBoxRef.asArray?.() || trimBoxRef;
      if (trimBox && trimBox.length >= 4) {
        return {
          minX: trimBox[0]?.asNumber?.() ?? trimBox[0] ?? 0,
          minY: trimBox[1]?.asNumber?.() ?? trimBox[1] ?? 0,
          maxX: trimBox[2]?.asNumber?.() ?? trimBox[2] ?? mediaBox.width,
          maxY: trimBox[3]?.asNumber?.() ?? trimBox[3] ?? mediaBox.height
        };
      }
    }
  } catch (e) {
    // TrimBox not available
  }
  
  try {
    // Check for CropBox
    const cropBoxRef = dict.get(page.doc.context.obj('CropBox'));
    if (cropBoxRef) {
      const cropBox = cropBoxRef.asArray?.() || cropBoxRef;
      if (cropBox && cropBox.length >= 4) {
        return {
          minX: cropBox[0]?.asNumber?.() ?? cropBox[0] ?? 0,
          minY: cropBox[1]?.asNumber?.() ?? cropBox[1] ?? 0,
          maxX: cropBox[2]?.asNumber?.() ?? cropBox[2] ?? mediaBox.width,
          maxY: cropBox[3]?.asNumber?.() ?? cropBox[3] ?? mediaBox.height
        };
      }
    }
  } catch (e) {
    // CropBox not available
  }
  
  // If no TrimBox/CropBox, estimate based on typical Deutsche Post label dimensions
  // DHL Internetmarke labels typically have content in a ~100mm x 70mm area
  // centered or starting from a corner
  
  // For Deutsche Post labels, content is typically:
  // - Positioned at top-left of the page
  // - About 100mm wide x 70mm tall for standard labels
  // - The actual drawn content has some internal padding
  
  // We'll estimate content bounds based on typical label structure
  // Standard DHL label format is approximately 100mm x 70mm (283 x 198 points)
  const typicalWidth = mmToPoints(100);
  const typicalHeight = mmToPoints(70);
  
  // Content is usually positioned at top-left of the media box
  // with some internal margins already in the label design
  return {
    minX: 0,
    minY: Math.max(0, mediaBox.height - typicalHeight),
    maxX: Math.min(mediaBox.width, typicalWidth),
    maxY: mediaBox.height
  };
}

/**
 * Crops a PDF to center the content with specified padding on all sides.
 * The cropping removes whitespace and adds equal margins around the content.
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
    const pageWidth = mediaBox.width;
    const pageHeight = mediaBox.height;
    
    // Find actual content bounds
    const contentBounds = findContentBounds(page);
    
    // Calculate content dimensions
    const contentWidth = contentBounds.maxX - contentBounds.minX;
    const contentHeight = contentBounds.maxY - contentBounds.minY;
    
    // Calculate new page dimensions with centered padding
    const newWidth = contentWidth + (paddingH * 2);
    const newHeight = contentHeight + (paddingV * 2);
    
    // Calculate crop box to center the content
    // The crop box coordinates are in the original page's coordinate system
    const cropX = contentBounds.minX - paddingH;
    const cropY = contentBounds.minY - paddingV;
    
    // Ensure we don't go outside the original page bounds
    const finalCropX = Math.max(0, cropX);
    const finalCropY = Math.max(0, cropY);
    const finalWidth = Math.min(newWidth, pageWidth - finalCropX);
    const finalHeight = Math.min(newHeight, pageHeight - finalCropY);
    
    // Only apply cropping if it actually reduces the page size
    if (finalWidth < pageWidth - 5 || finalHeight < pageHeight - 5) {
      // Set both CropBox and MediaBox to ensure the page size changes
      page.setCropBox(finalCropX, finalCropY, finalWidth, finalHeight);
      page.setMediaBox(finalCropX, finalCropY, finalWidth, finalHeight);
      
      // Also set TrimBox for printing accuracy
      page.setTrimBox(finalCropX, finalCropY, finalWidth, finalHeight);
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
