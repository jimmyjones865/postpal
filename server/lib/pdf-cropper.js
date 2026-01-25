import { PDFDocument, degrees } from 'pdf-lib';
import pkg from 'pdfjs-dist/legacy/build/pdf.js';
const { getDocument } = pkg;
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

// Guardrails against false detections (e.g. a single noisy pixel row)
const MIN_CONTENT_MM = 20; // anything smaller is almost certainly wrong for shipping labels
const MIN_INK_PIXELS_PER_ROW = 10;
const MIN_INK_PIXELS_PER_COL = 10;

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

  // Required for pdfjs-dist v3.x to render embedded images (QR codes, barcodes)
  _createCanvas(width, height) {
    return createCanvas(width, height);
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
    
    // Scan for non-white pixels.
    // We keep per-row/per-column counts so we can ignore isolated “noise” pixels.
    const scanForBounds = (whiteThreshold, rowThreshold, colThreshold) => {
      const rowInk = new Uint32Array(height);
      const colInk = new Uint32Array(width);
      let totalInk = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];

          // If not white (any channel below threshold)
          if (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold) {
            totalInk++;
            rowInk[y]++;
            colInk[x]++;
          }
        }
      }

      let minX = width, minY = height, maxX = -1, maxY = -1;

      for (let y = 0; y < height; y++) {
        if (rowInk[y] >= rowThreshold) {
          minY = y;
          break;
        }
      }
      for (let y = height - 1; y >= 0; y--) {
        if (rowInk[y] >= rowThreshold) {
          maxY = y;
          break;
        }
      }
      for (let x = 0; x < width; x++) {
        if (colInk[x] >= colThreshold) {
          minX = x;
          break;
        }
      }
      for (let x = width - 1; x >= 0; x--) {
        if (colInk[x] >= colThreshold) {
          maxX = x;
          break;
        }
      }

      const hasContent = totalInk > 0 && maxX >= 0 && maxY >= 0 && minX < width && minY < height;

      return { totalInk, minX, minY, maxX, maxY, hasContent };
    };

    // Determine content bounds using per-row/per-col thresholds to ignore noise.
    // Dynamic thresholds prevent sensitivity differences for different page sizes.
    const rowThreshold1 = Math.max(MIN_INK_PIXELS_PER_ROW, Math.floor(width * 0.002));
    const colThreshold1 = Math.max(MIN_INK_PIXELS_PER_COL, Math.floor(height * 0.002));
    let scan = scanForBounds(WHITE_THRESHOLD, rowThreshold1, colThreshold1);

    // If we detected something absurdly small, do a second pass with a more tolerant threshold.
    if (scan.hasContent) {
      const detectedWidthPts = (scan.maxX - scan.minX + 1) / RENDER_SCALE;
      const detectedHeightPts = (scan.maxY - scan.minY + 1) / RENDER_SCALE;
      const detectedWidthMm = pointsToMm(detectedWidthPts);
      const detectedHeightMm = pointsToMm(detectedHeightPts);

      if (detectedWidthMm < MIN_CONTENT_MM || detectedHeightMm < MIN_CONTENT_MM) {
        const rowThreshold2 = Math.max(5, Math.floor(width * 0.001));
        const colThreshold2 = Math.max(5, Math.floor(height * 0.001));
        scan = scanForBounds(254, rowThreshold2, colThreshold2);
      }
    }

    const { minX, minY, maxX, maxY, hasContent } = scan;
    
    // Actual page dimensions in PDF points (for fallback)
    const actualPageWidthPts = viewport.width / RENDER_SCALE;
    const actualPageHeightPts = viewport.height / RENDER_SCALE;
    
    console.log(`[PDFCropper] Page ${pageNum}: canvas ${width}x${height}px, found ${scan.totalInk} ink pixels`);
    
    // Fallback if no content detected - use actual page bounds and flag it
    if (!hasContent) {
      console.warn(`[PDFCropper] No content detected on page ${pageNum} - using full page (${Math.round(actualPageWidthPts)}x${Math.round(actualPageHeightPts)} pts)`);
      results.push({
        minX: 0,
        minY: 0,
        maxX: actualPageWidthPts,
        maxY: actualPageHeightPts,
        fallback: true
      });
    } else {
      // Sanity-check: ignore absurdly small detections (often caused by a single line/pixel)
      const detectedWidthPts = (maxX - minX + 1) / RENDER_SCALE;
      const detectedHeightPts = (maxY - minY + 1) / RENDER_SCALE;

      const detectedWidthMm = pointsToMm(detectedWidthPts);
      const detectedHeightMm = pointsToMm(detectedHeightPts);

      if (detectedWidthMm < MIN_CONTENT_MM || detectedHeightMm < MIN_CONTENT_MM) {
        const actualPageWidthPts2 = viewport.width / RENDER_SCALE;
        const actualPageHeightPts2 = viewport.height / RENDER_SCALE;
        console.warn(
          `[PDFCropper] Suspiciously small content bounds on page ${pageNum} (${detectedWidthMm.toFixed(1)}x${detectedHeightMm.toFixed(1)}mm). Falling back to full page.`
        );
        results.push({
          minX: 0,
          minY: 0,
          maxX: actualPageWidthPts2,
          maxY: actualPageHeightPts2,
          fallback: true
        });
        continue;
      }

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

    // If detection failed, don't apply cropping - keep original page size
    if (b.fallback) {
      console.log(`[PDFCropper] Page ${i + 1}: detection failed, keeping original size`);
      continue;
    }

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
 * Gets content dimensions without modifying the PDF.
 * Useful for previewing the expected output size before printing.
 * 
 * @param {Buffer} pdfBuffer - Original PDF buffer
 * @param {number} paddingHorizontalMm - Horizontal padding in mm (default 5)
 * @param {number} paddingVerticalMm - Vertical padding in mm (default 5)
 * @returns {Promise<{original: {widthMm: number, heightMm: number}, cropped: {widthMm: number, heightMm: number} | null}>}
 */
export async function getContentDimensions(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  const bounds = await getContentBoundsPerPage(pdfBuffer);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  
  if (pages.length === 0 || bounds.length === 0) {
    return { original: { widthMm: 0, heightMm: 0 }, cropped: null };
  }
  
  const page = pages[0];
  const b = bounds[0];
  const padX = mmToPoints(paddingHorizontalMm);
  const padY = mmToPoints(paddingVerticalMm);
  
  const originalWidth = page.getWidth();
  const originalHeight = page.getHeight();
  
  // If detection failed, return null for cropped dimensions
  if (b.fallback) {
    return {
      original: {
        widthMm: Math.round(pointsToMm(originalWidth) * 10) / 10,
        heightMm: Math.round(pointsToMm(originalHeight) * 10) / 10
      },
      cropped: null
    };
  }
  
  const croppedWidth = (b.maxX - b.minX) + padX * 2;
  const croppedHeight = (b.maxY - b.minY) + padY * 2;
  
  return {
    original: {
      widthMm: Math.round(pointsToMm(originalWidth) * 10) / 10,
      heightMm: Math.round(pointsToMm(originalHeight) * 10) / 10
    },
    cropped: {
      widthMm: Math.round(pointsToMm(croppedWidth) * 10) / 10,
      heightMm: Math.round(pointsToMm(croppedHeight) * 10) / 10
    }
  };
}

/**
 * Crops a PDF and returns both the cropped buffer AND dimensions in a single call.
 * This avoids duplicate pixel scanning operations.
 * 
 * @param {Buffer} pdfBuffer - Original PDF buffer (NOT modified)
 * @param {number} paddingHorizontalMm - Horizontal padding in mm (default 5)
 * @param {number} paddingVerticalMm - Vertical padding in mm (default 5)
 * @returns {Promise<{buffer: Buffer, dimensions: {original: {...}, cropped: {...} | null}, fallback: boolean}>}
 */
export async function cropPdfWithPaddingAndDimensions(
  pdfBuffer,
  paddingHorizontalMm = 5,
  paddingVerticalMm = 5
) {
  const bounds = await getContentBoundsPerPage(pdfBuffer);
  
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  const padX = mmToPoints(paddingHorizontalMm);
  const padY = mmToPoints(paddingVerticalMm);
  
  // Get original dimensions from first page
  const originalWidth = pages[0].getWidth();
  const originalHeight = pages[0].getHeight();
  
  const b = bounds[0];
  const hasFallback = b.fallback === true;
  
  let croppedWidthPts, croppedHeightPts;
  
  for (let i = 0; i < pages.length; i++) {
    const pageBounds = bounds[i];

    // If detection failed, don't apply cropping - keep original page size
    if (pageBounds.fallback) {
      console.log(`[PDFCropper] Page ${i + 1}: detection failed, keeping original size`);
      continue;
    }

    // Calculate new page dimensions: content + uniform padding on all sides
    const newMinX = pageBounds.minX - padX;
    const newMinY = pageBounds.minY - padY;
    const newWidth = (pageBounds.maxX - pageBounds.minX) + padX * 2;
    const newHeight = (pageBounds.maxY - pageBounds.minY) + padY * 2;
    
    // Store first page cropped dimensions
    if (i === 0) {
      croppedWidthPts = newWidth;
      croppedHeightPts = newHeight;
    }

    console.log(`[PDFCropper] Page ${i + 1}: content ${Math.round(pageBounds.maxX - pageBounds.minX)}x${Math.round(pageBounds.maxY - pageBounds.minY)} pts → cropped ${Math.round(newWidth)}x${Math.round(newHeight)} pts (${paddingHorizontalMm}mm/${paddingVerticalMm}mm padding)`);

    // Set all box types to ensure consistent cropping across viewers/printers
    pages[i].setMediaBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setCropBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setTrimBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setBleedBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setArtBox(newMinX, newMinY, newWidth, newHeight);
  }

  return {
    buffer: Buffer.from(await pdfDoc.save()),
    dimensions: {
      original: {
        widthMm: Math.round(pointsToMm(originalWidth) * 10) / 10,
        heightMm: Math.round(pointsToMm(originalHeight) * 10) / 10
      },
      cropped: hasFallback ? null : {
        widthMm: Math.round(pointsToMm(croppedWidthPts) * 10) / 10,
        heightMm: Math.round(pointsToMm(croppedHeightPts) * 10) / 10
      }
    },
    fallback: hasFallback
  };
}

