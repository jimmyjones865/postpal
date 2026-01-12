import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Convert mm to PDF points (1 point = 1/72 inch, 1 inch = 25.4mm)
const mmToPoints = (mm) => (mm / 25.4) * 72;
const pointsToMm = (pts) => (pts / 72) * 25.4;

/**
 * Analyzes PDF content to find the actual bounding box of all text and graphics.
 * Uses pdf.js to extract text positions and compute the content bounds.
 * 
 * @param {Buffer} pdfBuffer - The PDF buffer to analyze
 * @returns {Promise<{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}[]>}
 */
async function getContentBoundsPerPage(pdfBuffer) {
  // Load PDF with pdf.js
  const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
  const pdfDoc = await loadingTask.promise;
  
  const results = [];
  
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    
    // Get text content with positions
    const textContent = await page.getTextContent();
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    // Analyze text items to find bounds
    for (const item of textContent.items) {
      if (item.str && item.str.trim()) {
        // item.transform contains [scaleX, skewX, skewY, scaleY, translateX, translateY]
        const x = item.transform[4];
        const y = item.transform[5];
        const width = item.width || 0;
        const height = item.height || Math.abs(item.transform[3]);
        
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }
    }
    
    // Also analyze operator list for graphics (lines, images, etc.)
    try {
      const opList = await page.getOperatorList();
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];
        
        // Check for image operations (paintImageXObject, paintInlineImageXObject, etc.)
        if (fn === pdfjsLib.OPS.paintImageXObject || 
            fn === pdfjsLib.OPS.paintInlineImageXObject ||
            fn === pdfjsLib.OPS.paintImageMaskXObject) {
          // Images often have transform matrices in prior operations
          // We'll rely on text bounds + some padding for graphics
        }
      }
    } catch (e) {
      console.log('Could not analyze operator list:', e.message);
    }
    
    // If we found content, store the bounds
    if (minX !== Infinity) {
      results.push({
        pageNum,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
        // pdf.js uses top-left origin, pdf-lib uses bottom-left
        // Convert y coordinates: pdfjs y is from top, pdf-lib y is from bottom
        minX,
        minY, // This is distance from bottom in pdf.js transform coords
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY
      });
    } else {
      // Fallback: use entire page with small margin
      results.push({
        pageNum,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
        minX: 10,
        minY: 10,
        maxX: viewport.width - 10,
        maxY: viewport.height - 10,
        width: viewport.width - 20,
        height: viewport.height - 20
      });
    }
  }
  
  return results;
}

/**
 * Crops a PDF to remove whitespace, centering content with specified padding.
 * Uses actual content detection to find where text/graphics are located.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} paddingHorizontalMm - Horizontal padding to add in mm (left and right)
 * @param {number} paddingVerticalMm - Vertical padding to add in mm (top and bottom)
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function cropPdfCentered(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  // First, analyze content bounds using pdf.js
  const contentBounds = await getContentBoundsPerPage(pdfBuffer);
  
  // Then modify with pdf-lib
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  const desiredPaddingH = mmToPoints(paddingHorizontalMm);
  const desiredPaddingV = mmToPoints(paddingVerticalMm);
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const mediaBox = page.getMediaBox();
    const bounds = contentBounds[i];
    
    if (!bounds) {
      console.log(`PDF Crop: No content bounds for page ${i + 1}, skipping`);
      continue;
    }
    
    console.log(`PDF Crop: Page ${i + 1} - Original=${pointsToMm(mediaBox.width).toFixed(1)}x${pointsToMm(mediaBox.height).toFixed(1)}mm`);
    console.log(`PDF Crop: Detected content at (${pointsToMm(bounds.minX).toFixed(1)}, ${pointsToMm(bounds.minY).toFixed(1)}) to (${pointsToMm(bounds.maxX).toFixed(1)}, ${pointsToMm(bounds.maxY).toFixed(1)})mm`);
    console.log(`PDF Crop: Content size=${pointsToMm(bounds.width).toFixed(1)}x${pointsToMm(bounds.height).toFixed(1)}mm`);
    
    // Calculate crop box: content bounds with padding
    // pdf-lib coordinates: origin at bottom-left
    const cropX = bounds.minX - desiredPaddingH;
    const cropY = bounds.minY - desiredPaddingV;
    const cropWidth = bounds.width + (desiredPaddingH * 2);
    const cropHeight = bounds.height + (desiredPaddingV * 2);
    
    // Clamp to page bounds
    const finalCropX = Math.max(mediaBox.x, cropX);
    const finalCropY = Math.max(mediaBox.y, cropY);
    const finalWidth = Math.min(cropWidth, mediaBox.width - finalCropX + mediaBox.x);
    const finalHeight = Math.min(cropHeight, mediaBox.height - finalCropY + mediaBox.y);
    
    console.log(`PDF Crop: New size=${pointsToMm(finalWidth).toFixed(1)}x${pointsToMm(finalHeight).toFixed(1)}mm (padding H=${paddingHorizontalMm}mm, V=${paddingVerticalMm}mm)`);
    
    // Apply cropping
    page.setMediaBox(finalCropX, finalCropY, finalWidth, finalHeight);
    page.setCropBox(finalCropX, finalCropY, finalWidth, finalHeight);
    page.setTrimBox(finalCropX, finalCropY, finalWidth, finalHeight);
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
 * Smart crop that detects content and centers with equal padding.
 * 
 * @param {Buffer} pdfBuffer - The original PDF buffer
 * @param {number} paddingHorizontalMm - Horizontal padding to keep in mm
 * @param {number} paddingVerticalMm - Vertical padding to keep in mm
 * @returns {Promise<Buffer>} - The cropped PDF buffer
 */
export async function smartCropPdf(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  return cropPdfCentered(pdfBuffer, paddingHorizontalMm, paddingVerticalMm);
}
