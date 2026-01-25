

# Plan: Fix PDF Content Detection - Missing Font Rendering

## Root Cause Identified

The PDF cropper is only detecting **60 ink pixels** because `pdfjs-dist` is configured with `disableFontFace: true` on line 63 of `server/lib/pdf-cropper.js`:

```javascript
const pdf = await getDocument({ data, disableFontFace: true, canvasFactory }).promise;
```

**This option prevents ALL text from rendering to the canvas.** The label you uploaded has text for addresses, tracking numbers, "GOGREEN", "Deutsche Post", etc. - none of this is being drawn. Only some minor graphical artifacts are appearing (the 60 pixels), likely from partial image/vector rendering.

The actual label should have **tens of thousands** of ink pixels from all the text, QR code, barcode, and logos.

---

## Solution Overview

1. **Remove `disableFontFace: true`** - Allow font rendering
2. **Add proper pdfjs-dist configuration** - Configure CMaps and standard fonts for complete rendering
3. **Keep fallback behavior** - If rendering still fails for some reason, use original PDF dimensions (per your preference)

---

## Detailed Changes

### File: `server/lib/pdf-cropper.js`

#### Change 1: Add Required Imports

Add `path` and `fileURLToPath` for constructing absolute paths to pdfjs-dist resources:

```javascript
import { PDFDocument, degrees } from 'pdf-lib';
import pkg from 'pdfjs-dist/legacy/build/pdf.js';
const { getDocument, GlobalWorkerOptions } = pkg;
import { createCanvas } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

#### Change 2: Configure pdfjs-dist Paths

Set up worker, CMaps, and standard fonts paths (pdfjs-dist v3.x requires these for proper rendering):

```javascript
// Configure PDF.js worker (optional but recommended)
GlobalWorkerOptions.workerSrc = path.resolve(
  __dirname, 
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.js'
);

// CMaps for international text encoding
const CMAP_URL = path.resolve(__dirname, '../../node_modules/pdfjs-dist/cmaps/');
// Standard fonts fallback
const STANDARD_FONT_DATA_URL = path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/');
```

#### Change 3: Fix `getDocument` Configuration

Remove `disableFontFace: true` and add proper configuration:

```javascript
const pdf = await getDocument({
  data,
  canvasFactory,
  // Enable font rendering (removed disableFontFace: true)
  cMapUrl: CMAP_URL,
  cMapPacked: true,
  standardFontDataUrl: STANDARD_FONT_DATA_URL,
}).promise;
```

---

## Why This Fixes the Problem

| Before | After |
|--------|-------|
| `disableFontFace: true` prevents text rendering | Fonts render normally |
| No CMap configuration - may fail on special chars | CMaps loaded for international text |
| No standard font fallback | Fallback fonts available |
| 60 ink pixels detected | Expected: 10,000+ ink pixels |
| Detection "fails", uses 100mm fallback | Proper bounds detected, correct crop |

---

## Expected Behavior After Fix

```
[PDFCropper] Page 1: canvas 498x272px, found 45823 ink pixels
[PDFCropper] Page 1: detected content at pixels (45,28)-(455,248) → PDF points (...)
[PDFCropper] Page 1: content 205x110 pts → cropped 222x127 pts (3mm/3mm padding)
[Print] PDF cropped to 78x45mm
[Print] Endless roll portrait: width=88mm, height=45.0mm
```

---

## Summary of Changes

| File | Location | Change |
|------|----------|--------|
| `server/lib/pdf-cropper.js` | Lines 1-5 | Add `path`, `fileURLToPath`, `GlobalWorkerOptions` imports |
| `server/lib/pdf-cropper.js` | After imports | Add `__dirname` equivalent and path configurations |
| `server/lib/pdf-cropper.js` | Line 63 | Replace `getDocument` call with full configuration |

---

## Technical Notes

- **pdfjs-dist v3.11.174** (the installed version) is the legacy Node.js compatible version
- The `legacy/build/pdf.js` path is correct for this version
- CMaps are needed for fonts with non-standard encoding (common in shipping labels)
- Standard fonts provide fallbacks when the PDF doesn't embed fonts
- The `canvasFactory` is already correctly implemented for node-canvas

