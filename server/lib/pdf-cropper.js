import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';

/**
 * PDF Cropper for Deutsche Post shipping labels
 * 
 * Uses pixel-based detection: renders each page to canvas and scans for
 * non-white pixels to find the exact content bounding box.
 * 
 * Labels are always black and white - anything not white is printable content.
 */

const mmToPoints = (mm) => (mm / 25.4) * 72;
const pointsToMm = (pts) => (pts / 72) * 25.4;

// Render scale for pixel detection (2x provides good accuracy)
const RENDER_SCALE = 2;

// White threshold (< 250 catches anti-aliased edges)
const WHITE_THRESHOLD = 250;

/**
 * Custom CanvasFactory for pdfjs-dist in Node.js environment
 */
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Detects content bounds by rendering PDF pages and scanning for non-white pixels.
 */
async function getContentBoundsPerPage(pdfBuffer) {
  const data = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer;
  const canvasFactory = new NodeCanvasFactory();
  const pdf = await getDocument({ data, disableFontFace: true, canvasFactory }).promise;

  const results = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    
    // Create canvas and render page
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    
    // Fill with white first
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    
    // Render PDF page to canvas
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    // Get pixel data
    const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height);
    const pixels = imageData.data;
    const width = viewport.width;
    const height = viewport.height;
    
    // Scan for non-white pixels
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasContent = false;
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        
        // If not white (any channel below threshold)
        if (r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD) {
          hasContent = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    
    // Fallback if no content detected
    if (!hasContent) {
      console.warn('[PDFCropper] No content detected on page', pageNum, '- using full page');
      results.push({
        minX: 0,
        minY: 0,
        maxX: viewport.width / RENDER_SCALE,
        maxY: viewport.height / RENDER_SCALE
      });
    } else {
      // Convert pixel coordinates back to PDF points
      // Note: PDF Y-axis is inverted (origin at bottom-left)
      results.push({
        minX: minX / RENDER_SCALE,
        minY: (height - maxY - 1) / RENDER_SCALE,
        maxX: (maxX + 1) / RENDER_SCALE,
        maxY: (height - minY) / RENDER_SCALE
      });
      
      console.log(`[PDFCropper] Page ${pageNum}: detected content at pixels (${minX},${minY})-(${maxX},${maxY}) → PDF points (${Math.round(results[pageNum-1].minX)},${Math.round(results[pageNum-1].minY)})-(${Math.round(results[pageNum-1].maxX)},${Math.round(results[pageNum-1].maxY)})`);
    }
  }

  await pdf.destroy();
  return results;
}

/**
 * Crops a PDF to its content bounds and adds a uniform white border.
 * 
 * @param {Buffer} pdfBuffer - Original PDF buffer (NOT modified)
 * @param {number} paddingHorizontalMm - Horizontal padding in mm (default 5)
 * @param {number} paddingVerticalMm - Vertical padding in mm (default 5)
 * @returns {Promise<Buffer>} - New cropped PDF buffer
 */
export async function cropPdfWithPadding(
  pdfBuffer,
  paddingHorizontalMm = 5,
  paddingVerticalMm = 5
) {
  const bounds = await getContentBoundsPerPage(pdfBuffer);
  
  // Load a fresh copy - original buffer is never modified
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  const padX = mmToPoints(paddingHorizontalMm);
  const padY = mmToPoints(paddingVerticalMm);

  for (let i = 0; i < pages.length; i++) {
    const b = bounds[i];

    // Calculate new page dimensions: content + uniform padding on all sides
    const newMinX = b.minX - padX;
    const newMinY = b.minY - padY;
    const newWidth = (b.maxX - b.minX) + padX * 2;
    const newHeight = (b.maxY - b.minY) + padY * 2;

    console.log(`[PDFCropper] Page ${i + 1}: content ${Math.round(b.maxX - b.minX)}x${Math.round(b.maxY - b.minY)} pts → cropped ${Math.round(newWidth)}x${Math.round(newHeight)} pts (${paddingHorizontalMm}mm/${paddingVerticalMm}mm padding)`);

    // Set all box types to ensure consistent cropping across viewers/printers
    pages[i].setMediaBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setCropBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setTrimBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setBleedBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setArtBox(newMinX, newMinY, newWidth, newHeight);
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * Rotates PDF pages by a specified angle.
 * 
 * @param {Buffer} pdfBuffer - Original PDF buffer
 * @param {number} angle - Rotation angle in degrees (90, 180, 270)
 * @returns {Promise<Buffer>} - Rotated PDF buffer
 */
export async function rotatePdf(pdfBuffer, angle = 90) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  for (const page of pages) {
    const currentRotation = page.getRotation().angle;
    page.setRotation(degrees(currentRotation + angle));
  }
  
  return Buffer.from(await pdfDoc.save());
}

/**
 * Prepares a PDF for endless roll printing by setting page dimensions.
 * 
 * @param {Buffer} pdfBuffer - Original PDF buffer (should be cropped first)
 * @param {number} rollWidthMm - Width of the roll paper in mm
 * @param {boolean} landscape - If true, rotate 90° (swap dimensions)
 * @returns {Promise<{buffer: Buffer, contentWidthMm: number, contentHeightMm: number}>}
 */
export async function prepareForEndlessRoll(pdfBuffer, rollWidthMm, landscape = false) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  const results = [];
  
  for (const page of pages) {
    const { width, height } = page.getSize();
    const contentWidthPts = width;
    const contentHeightPts = height;
    
    const rollWidthPts = mmToPoints(rollWidthMm);
    
    if (landscape) {
      // Rotate page 90° and swap dimensions
      // Roll width becomes the height, content flows along the roll length
      page.setRotation(degrees(90));
      
      // After rotation, the new visible dimensions are swapped
      // We want: roll width = visible height, content width = visible width
      page.setMediaBox(0, 0, contentHeightPts, rollWidthPts);
      page.setCropBox(0, 0, contentHeightPts, rollWidthPts);
      page.setTrimBox(0, 0, contentHeightPts, rollWidthPts);
    } else {
      // Portrait: Roll width is the page width, content height is the page height
      page.setMediaBox(0, 0, rollWidthPts, contentHeightPts);
      page.setCropBox(0, 0, rollWidthPts, contentHeightPts);
      page.setTrimBox(0, 0, rollWidthPts, contentHeightPts);
    }
    
    results.push({
      originalWidth: pointsToMm(contentWidthPts),
      originalHeight: pointsToMm(contentHeightPts)
    });
  }
  
  const buffer = Buffer.from(await pdfDoc.save());
  
  return {
    buffer,
    contentWidthMm: results[0]?.originalWidth || 0,
    contentHeightMm: results[0]?.originalHeight || 0
  };
}

/**
 * @deprecated Legacy name – use cropPdfWithPadding instead.
 */
export async function cropPdfWhitespace(
  pdfBuffer,
  marginHorizontalMm = 5,
  marginVerticalMm = 5
) {
  return cropPdfWithPadding(pdfBuffer, marginHorizontalMm, marginVerticalMm);
}

/**
 * @deprecated Legacy alias – use cropPdfWithPadding instead.
 */
export async function smartCropPdf(
  pdfBuffer,
  paddingHorizontalMm = 5,
  paddingVerticalMm = 5
) {
  return cropPdfWithPadding(pdfBuffer, paddingHorizontalMm, paddingVerticalMm);
}
