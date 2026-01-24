import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * PDF Cropper for Deutsche Post shipping labels
 * 
 * Detects all non-white content (text, images, vector paths) and crops the PDF
 * to that content area plus a configurable uniform white border.
 * 
 * Labels are always black and white - anything not white is printable content.
 */

const mmToPoints = (mm) => (mm / 25.4) * 72;

// ---------------- matrix helpers ----------------
function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

function transformPoint(m, x, y) {
  return [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5]
  ];
}

function expandBounds(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

// ---------------- content detection ----------------
async function getContentBoundsPerPage(pdfBuffer) {
  const data = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer;
  const pdf = await getDocument({ data, disableFontFace: true }).promise;

  const results = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    // ---- TEXT ----
    try {
      const text = await page.getTextContent();
      for (const item of text.items) {
        if (!item.str || !item.str.trim()) continue;

        const x = item.transform[4];
        const y = item.transform[5];
        const fontSize = Math.abs(item.transform[3]) || 12;

        // Approximate text bounds
        const ascent = fontSize * 0.8;
        const descent = fontSize * 0.3;
        const width = item.width || fontSize * item.str.length * 0.5;

        expandBounds(bounds, x, y - descent);
        expandBounds(bounds, x + width, y + ascent);
      }
    } catch (err) {
      console.warn('[PDFCropper] Text extraction failed:', err.message);
    }

    // ---- GRAPHICS (Images + Vector paths) ----
    try {
      const ops = await page.getOperatorList();
      let ctmStack = [[1, 0, 0, 1, 0, 0]];
      let currentPath = [];

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        const ctm = ctmStack.at(-1);

        switch (fn) {
          case OPS.save:
            ctmStack.push([...ctm]);
            break;

          case OPS.restore:
            if (ctmStack.length > 1) ctmStack.pop();
            break;

          case OPS.transform:
            ctmStack[ctmStack.length - 1] = multiplyMatrix(args, ctm);
            break;

          // ---- Images ----
          case OPS.paintImageXObject:
          case OPS.paintInlineImageXObject:
          case OPS.paintImageMaskXObject: {
            const sx = Math.hypot(ctm[0], ctm[1]);
            const sy = Math.hypot(ctm[2], ctm[3]);
            if (!sx || !sy) break;

            // Image is drawn in a 1x1 unit square, transformed by CTM
            const corners = [
              transformPoint(ctm, 0, 0),
              transformPoint(ctm, 1, 0),
              transformPoint(ctm, 0, 1),
              transformPoint(ctm, 1, 1)
            ];

            for (const [cx, cy] of corners) {
              expandBounds(bounds, cx, cy);
            }
            break;
          }

          // ---- Path construction ----
          case OPS.moveTo:
            currentPath = [[args[0], args[1]]];
            break;

          case OPS.lineTo:
            currentPath.push([args[0], args[1]]);
            break;

          case OPS.curveTo:
            // Bezier curve: add control points and end point
            currentPath.push([args[0], args[1]]);
            currentPath.push([args[2], args[3]]);
            currentPath.push([args[4], args[5]]);
            break;

          case OPS.curveTo2:
            currentPath.push([args[0], args[1]]);
            currentPath.push([args[2], args[3]]);
            break;

          case OPS.curveTo3:
            currentPath.push([args[0], args[1]]);
            currentPath.push([args[2], args[3]]);
            break;

          case OPS.rectangle:
            // Rectangle: x, y, width, height
            currentPath.push([args[0], args[1]]);
            currentPath.push([args[0] + args[2], args[1]]);
            currentPath.push([args[0] + args[2], args[1] + args[3]]);
            currentPath.push([args[0], args[1] + args[3]]);
            break;

          case OPS.closePath:
            // Path closed, points already recorded
            break;

          // ---- Path painting (stroke/fill = visible content) ----
          case OPS.stroke:
          case OPS.closeStroke:
          case OPS.fill:
          case OPS.eoFill:
          case OPS.fillStroke:
          case OPS.eoFillStroke:
          case OPS.closeFillStroke:
          case OPS.closeEOFillStroke:
            // Transform and add all path points to bounds
            for (const [px, py] of currentPath) {
              const [tx, ty] = transformPoint(ctm, px, py);
              expandBounds(bounds, tx, ty);
            }
            currentPath = [];
            break;

          case OPS.endPath:
            // Path ended without painting (clipping path, etc.)
            currentPath = [];
            break;
        }
      }
    } catch (err) {
      console.warn('[PDFCropper] Graphics extraction failed:', err.message);
    }

    // Fallback if no content detected
    if (bounds.minX === Infinity) {
      const viewport = page.getViewport({ scale: 1 });
      bounds.minX = 0;
      bounds.minY = 0;
      bounds.maxX = viewport.width;
      bounds.maxY = viewport.height;
      console.warn('[PDFCropper] No content detected on page', pageNum, '- using full page');
    }

    results.push(bounds);
  }

  await pdf.destroy();
  return results;
}

// ---------------- crop + uniform padding ----------------
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
