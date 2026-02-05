

# Label Preview as Image (Storage & Cropping Untouched)

## Overview

Add a **read-only** image rendering endpoint that converts stored PDFs to PNG for preview display. This change is purely additive and does not modify any existing functionality.

## What Remains Untouched

| Component | Status | Reason |
|-----------|--------|--------|
| `server/lib/label-storage.js` | No changes | Labels continue to be stored as PDF files |
| `server/lib/pdf-cropper.js` cropping functions | No changes | All cropping logic (`cropPdfWithPadding`, `cropPdfWithPaddingAndDimensions`) stays exactly as-is |
| `GET /labels/:id/pdf` endpoint | No changes | PDF download/print with cropping continues to work |
| `POST /print` endpoint | No changes | CUPS printing with cropping continues to work |

## Changes Summary

### 1. Add `renderPdfToImage` function (server/lib/pdf-cropper.js)

Add a **new export** at the end of the file. This function reuses the existing canvas infrastructure to render a PDF page to PNG:

```javascript
export async function renderPdfToImage(pdfBuffer, scale = 2) {
  // Uses existing NodeCanvasFactory, CMAP_URL, STANDARD_FONT_DATA_URL
  // Renders first page to canvas and returns PNG buffer
}
```

This is purely additive - no existing functions are modified.

### 2. Add `GET /labels/:id/image` endpoint (server/routes/labels.js)

Add a **new route** that serves the label as a rendered PNG image:

```javascript
router.get('/:id/image', async (req, res) => {
  const pdfBuffer = await storage.getLabelPdf(req.params.id);
  const imageBuffer = await renderPdfToImage(pdfBuffer);
  res.setHeader('Content-Type', 'image/png');
  res.send(imageBuffer);
});
```

Key points:
- Reads the original PDF from storage (unchanged)
- Renders to PNG on-the-fly (no file saved)
- No cropping applied (preview shows original label as-is)

### 3. Update frontend preview (src/components/LabelResult.tsx)

Replace the `<embed>` PDF viewer with an `<img>` tag:

```tsx
// Before:
<embed src={pdfUrl} type="application/pdf" ... />

// After:
<img src={imageUrl} alt="Purchased shipping label" ... />
```

The Download and Print buttons continue to use the existing PDF endpoint with cropping.

## Data Flow Comparison

```text
PREVIEW (new - image):
  LabelResult <img> --> GET /labels/:id/image --> render PDF to PNG --> display

DOWNLOAD (unchanged - PDF with cropping):
  handleDownload --> GET /labels/:id/pdf?print=1&cropTop=5... --> cropped PDF

PRINT (unchanged - PDF with cropping):
  handlePrint --> POST /print --> cropped PDF --> CUPS
```

## Technical Details

### Files to Modify

| File | Change |
|------|--------|
| `server/lib/pdf-cropper.js` | Add `renderPdfToImage()` export (~20 lines at end of file) |
| `server/routes/labels.js` | Add import + `GET /:id/image` route (~15 lines) |
| `src/components/LabelResult.tsx` | Replace `<embed>` with `<img>`, update URL variable (~5 lines) |

### No Changes To

- `server/lib/label-storage.js` - PDF storage unchanged
- `server/lib/pdf-cropper.js` existing functions - cropping unchanged
- `server/routes/print.js` - CUPS printing unchanged
- Download/Print functionality - continues to use PDF with cropping

