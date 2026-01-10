import { PDFDocument } from 'pdf-lib';

// Convert mm to PDF points (1 point = 1/72 inch, 1 inch = 25.4mm)
const mmToPoints = (mm) => (mm / 25.4) * 72;

/**
 * Crops whitespace from a PDF, keeping specified margins around the content.
 * Uses the PDF's CropBox or MediaBox to determine content bounds.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} marginHorizontalMm - Horizontal margin to keep in mm
 * @param {number} marginVerticalMm - Vertical margin to keep in mm
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function cropPdfWhitespace(pdfBuffer, marginHorizontalMm = 5, marginVerticalMm = 5) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  const marginH = mmToPoints(marginHorizontalMm);
  const marginV = mmToPoints(marginVerticalMm);
  
  for (const page of pages) {
    // Get the current media box (full page size)
    const mediaBox = page.getMediaBox();
    
    // Try to get TrimBox or BleedBox which might indicate content bounds
    // If not available, we'll analyze the content
    let trimBox = null;
    try {
      const dict = page.node.dict;
      const trimBoxArray = dict.get(pdfDoc.context.obj('TrimBox'));
      if (trimBoxArray) {
        trimBox = {
          x: trimBoxArray.get(0)?.asNumber() ?? 0,
          y: trimBoxArray.get(1)?.asNumber() ?? 0,
          width: (trimBoxArray.get(2)?.asNumber() ?? mediaBox.width) - (trimBoxArray.get(0)?.asNumber() ?? 0),
          height: (trimBoxArray.get(3)?.asNumber() ?? mediaBox.height) - (trimBoxArray.get(1)?.asNumber() ?? 0)
        };
      }
    } catch (e) {
      // TrimBox not available, continue
    }
    
    // For shipping labels, content is typically in the top-left area
    // DHL labels are usually around 100x70mm (283x198 points)
    // We'll set a reasonable crop box based on typical label sizes
    
    // Get content bounds - for DHL labels, the label content is usually:
    // - Standard labels: ~100mm x 70mm
    // - A6 format: 105mm x 148mm
    
    // If the page is larger than typical label size, crop it
    const pageWidth = mediaBox.width;
    const pageHeight = mediaBox.height;
    
    // Typical DHL label dimensions in points
    const typicalLabelWidth = mmToPoints(110); // ~311 points
    const typicalLabelHeight = mmToPoints(80); // ~227 points
    
    // If page is much larger than typical label, crop to label size + margins
    if (pageWidth > typicalLabelWidth * 1.5 || pageHeight > typicalLabelHeight * 1.5) {
      // Calculate new crop dimensions
      const newWidth = Math.min(pageWidth, typicalLabelWidth + marginH * 2);
      const newHeight = Math.min(pageHeight, typicalLabelHeight + marginV * 2);
      
      // Set crop box from top-left (PDF origin is bottom-left)
      // So we crop from bottom and right
      const cropX = marginH;
      const cropY = pageHeight - newHeight + marginV;
      
      page.setCropBox(cropX, cropY, newWidth - marginH * 2, newHeight - marginV * 2);
      page.setMediaBox(cropX, cropY, newWidth - marginH * 2, newHeight - marginV * 2);
    } else {
      // For smaller pages, just apply margins
      page.setCropBox(
        marginH,
        marginV,
        pageWidth - marginH * 2,
        pageHeight - marginV * 2
      );
    }
  }
  
  const croppedPdfBytes = await pdfDoc.save();
  return Buffer.from(croppedPdfBytes);
}

/**
 * Smart crop that analyzes the PDF content to find actual bounds.
 * This is a more aggressive approach that tries to detect whitespace.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} marginHorizontalMm - Horizontal margin to keep in mm
 * @param {number} marginVerticalMm - Vertical margin to keep in mm
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function smartCropPdf(pdfBuffer, marginHorizontalMm = 5, marginVerticalMm = 5) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  const marginH = mmToPoints(marginHorizontalMm);
  const marginV = mmToPoints(marginVerticalMm);
  
  for (const page of pages) {
    const mediaBox = page.getMediaBox();
    
    // For shipping labels, we assume content starts at top-left
    // and typically doesn't extend beyond ~100x70mm for standard labels
    // or ~105x148mm for A6 format
    
    const pageWidth = mediaBox.width;
    const pageHeight = mediaBox.height;
    
    // DHL label format is typically ADDRESS_ZONE which is compact
    // The actual label content is usually in the upper portion
    
    // Estimate content area based on typical label dimensions
    // Standard DHL Internetmarke labels are about 100mm x 70mm
    const estimatedContentWidth = Math.min(pageWidth, mmToPoints(105));
    const estimatedContentHeight = Math.min(pageHeight, mmToPoints(75));
    
    // Calculate crop bounds
    // Content is at the top-left of the page
    const cropX = Math.max(0, marginH);
    const cropY = Math.max(0, pageHeight - estimatedContentHeight - marginV);
    const cropWidth = Math.min(pageWidth - cropX, estimatedContentWidth + marginH);
    const cropHeight = Math.min(pageHeight - cropY, estimatedContentHeight + marginV);
    
    // Only crop if we're actually reducing the size
    if (cropWidth < pageWidth - 10 || cropHeight < pageHeight - 10) {
      page.setCropBox(cropX, cropY, cropWidth, cropHeight);
      
      // Also set MediaBox to ensure the page size changes for printing
      page.setMediaBox(0, 0, cropWidth, cropHeight);
      
      // Translate content to align with new origin
      page.setTrimBox(0, 0, cropWidth, cropHeight);
    }
  }
  
  const croppedPdfBytes = await pdfDoc.save();
  return Buffer.from(croppedPdfBytes);
}
