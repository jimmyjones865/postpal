import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Unit conversions
const mmToPoints = (mm) => (mm / 25.4) * 72;

// Matrix helpers
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

/**
 * Detect tight content bounds per page (text + images)
 */
async function getContentBoundsPerPage(pdfBuffer) {
  const data = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer;
  const pdf = await getDocument({ data }).promise;

  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    // ---- TEXT ----
    const text = await page.getTextContent();

    for (const item of text.items) {
      if (!item.str || !item.str.trim()) continue;

      const x = item.transform[4];
      const y = item.transform[5];
      const fontSize = Math.abs(item.transform[3]);

      const ascent = fontSize * 0.8;
      const descent = fontSize * 0.3;
      const width =
        item.width || fontSize * item.str.length * 0.5;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + width);
      minY = Math.min(minY, y - descent);
      maxY = Math.max(maxY, y + ascent);
    }

    // ---- IMAGES ----
    try {
      const ops = await page.getOperatorList();
      let ctmStack = [[1, 0, 0, 1, 0, 0]];

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];

        if (fn === OPS.save) {
          ctmStack.push([...ctmStack.at(-1)]);
        } else if (fn === OPS.restore) {
          if (ctmStack.length > 1) ctmStack.pop();
        } else if (fn === OPS.transform) {
          ctmStack[ctmStack.length - 1] =
            multiplyMatrix(ctmStack.at(-1), args);
        } else if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject ||
          fn === OPS.paintImageMaskXObject
        ) {
          const ctm = ctmStack.at(-1);
          const corners = [
            transformPoint(ctm, 0, 0),
            transformPoint(ctm, 1, 0),
            transformPoint(ctm, 0, 1),
            transformPoint(ctm, 1, 1)
          ];

          for (const [cx, cy] of corners) {
            minX = Math.min(minX, cx);
            minY = Math.min(minY, cy);
            maxX = Math.max(maxX, cx);
            maxY = Math.max(maxY, cy);
          }
        }
      }
    } catch {
      // labels are simple; safe to ignore
    }

    if (minX === Infinity) {
      minX = minY = 0;
      maxX = maxY = 1;
    }

    pages.push({ minX, minY, maxX, maxY });
  }

  return pages;
}

/**
 * Core implementation:
 * crop to content, then expand symmetrically by padding
 */
export async function cropPdfWithPadding(
  pdfBuffer,
  paddingHorizontalMm = 5,
  paddingVerticalMm = 5
) {
  const bounds = await getContentBoundsPerPage(pdfBuffer);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  const padX = mmToPoints(paddingHorizontalMm);
  const padY = mmToPoints(paddingVerticalMm);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const b = bounds[i];

    const minX = b.minX - padX;
    const minY = b.minY - padY;
    const width = (b.maxX - b.minX) + padX * 2;
    const height = (b.maxY - b.minY) + padY * 2;

    page.setMediaBox(minX, minY, width, height);
    page.setCropBox(minX, minY, width, height);
    page.setTrimBox(minX, minY, width, height);
  }

  return Buffer.from(await pdfDoc.save());
}

/* ------------------------------------------------------------------
 * Aliases for drop-in compatibility with existing app
 * ------------------------------------------------------------------ */

export async function cropPdfCentered(
  pdfBuffer,
  paddingHorizontalMm = 5,
  paddingVerticalMm = 5
) {
  return cropPdfWithPadding(pdfBuffer, paddingHorizontalMm, paddingVerticalMm);
}

export async function cropPdfWhitespace(
  pdfBuffer,
  marginHorizontalMm = 5,
  marginVerticalMm = 5
) {
  return cropPdfWithPadding(pdfBuffer, marginHorizontalMm, marginVerticalMm);
}

export async function smartCropPdf(
  pdfBuffer,
  paddingHorizontalMm = 5,
  paddingVerticalMm = 5
) {
  return cropPdfWithPadding(pdfBuffer, paddingHorizontalMm, paddingVerticalMm);
}
