

# Plan: Fix PDF Cropping and Add Explicit Paper Settings

## Overview

This plan addresses:
1. **PDF cropping failure** - Downgrade `pdfjs-dist` to v3.x for stable Node.js canvas support
2. **Explicit paper settings** - Add `paperWidthMm`, `paperHeightMm`, and `endlessRoll` fields
3. **Mandatory cropping for endless roll** - Fail with clear error if cropping fails
4. **Unified orientation handling** - Portrait/landscape applies to all paper types
5. **Print scaling** - Add `print-scaling: none` to CUPS to ensure 100% scale

---

## Part 1: Fix pdfjs-dist Compatibility

### Problem
The error `Image or Canvas expected` indicates `pdfjs-dist` v4.x has breaking changes for Node.js canvas rendering.

### Solution
Downgrade to `pdfjs-dist@3.11.174` and update the canvas factory.

### Changes

**File: `server/package.json`**
```json
"pdfjs-dist": "^3.11.174"   // Downgrade from ^4.0.379
```

**File: `server/lib/pdf-cropper.js`**

1. Change import from `.mjs` to `.js`:
```javascript
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';
```

2. Add `_createCanvas` method to `NodeCanvasFactory` (required by v3.x for rendering embedded images like QR codes):
```javascript
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

  // Required for v3.x to render embedded images (QR codes, barcodes)
  _createCanvas(width, height) {
    return createCanvas(width, height);
  }
}
```

---

## Part 2: Add Explicit Paper Settings

### New Approach
Add three explicit fields to `PrinterConfig`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `paperWidthMm` | number | 62 | Paper width in mm |
| `paperHeightMm` | number | 100 | Paper height in mm (ignored if endless) |
| `endlessRoll` | boolean | true | If true, height is calculated from cropped content |

The existing `orientation` setting controls rotation for ALL paper types:
- **Portrait**: Label prints as-is
- **Landscape**: Label rotates 90°

### Dimension Logic

```text
After cropping, we have: croppedWidth, croppedHeight (in mm)

If endlessRoll = true:
  Portrait:   mediaWidth = paperWidthMm,  mediaHeight = croppedHeight
  Landscape:  mediaWidth = paperWidthMm,  mediaHeight = croppedWidth (rotated)

If endlessRoll = false:
  Portrait:   mediaWidth = paperWidthMm,  mediaHeight = paperHeightMm
  Landscape:  mediaWidth = paperHeightMm, mediaHeight = paperWidthMm (swapped)
```

### Files to Change

**`src/types/shipping.ts`**
Add new fields to `PrinterConfig`:
```typescript
export interface PrinterConfig {
  paperFormat: string;
  printerName: string;
  paperFormatName: string;
  orientation: 'portrait' | 'landscape';
  cropMarginHorizontal: number;
  cropMarginVertical: number;
  disableCropping: boolean;
  cupsUrl: string;
  enableDirectPrint: boolean;
  // New explicit paper settings
  paperWidthMm: number;       // Paper width in mm
  paperHeightMm: number;      // Paper height in mm (used when endlessRoll=false)
  endlessRoll: boolean;       // Height from content (true) or fixed (false)
}
```

**`src/hooks/useConfig.ts`**
Add defaults:
```typescript
printerConfig: {
  // ... existing fields ...
  paperWidthMm: 62,      // Common Brother label width
  paperHeightMm: 100,    // Default fixed height
  endlessRoll: true,     // Most label printers use endless roll
}
```

**`src/components/SettingsPanel.tsx`**
Add new section in the Printer tab after Orientation:

```text
─── Paper Size ─────────────────────────

Paper width (mm)
┌─────────────────────────────────────┐
│ 62                                  │
└─────────────────────────────────────┘

Paper height (mm)
┌─────────────────────────────────────┐
│ 100                                 │  ← disabled when endless
└─────────────────────────────────────┘

[✓] Endless roll (height from content)

When using endless roll, height is calculated
from the cropped label content automatically.
Use Landscape to rotate labels 90° to fit
narrow rolls.
```

---

## Part 3: Update Backend Print Logic

**`server/routes/api.js` - `/print` route**

### Read explicit settings from request:
```javascript
const { 
  labelId, cupsUrl, printerName, orientation, 
  cropH, cropV, disableCropping,
  // New explicit paper settings
  paperWidthMm, paperHeightMm, endlessRoll
} = req.body;
```

### Updated print flow:

1. **Load PDF** from storage

2. **Crop the PDF** and get dimensions:
   ```javascript
   let croppedDimensions = null;
   
   if (!disableCropping) {
     try {
       croppedDimensions = await getContentDimensions(pdfBuffer, cropMarginH, cropMarginV);
       pdfBuffer = await cropPdfWithPadding(pdfBuffer, cropMarginH, cropMarginV);
       console.log(`[Print] PDF cropped to ${croppedDimensions.cropped.widthMm}x${croppedDimensions.cropped.heightMm}mm`);
     } catch (cropErr) {
       console.error('[Print] Crop failed:', cropErr.message);
       
       // For endless roll, cropping is mandatory
       if (endlessRoll) {
         return res.status(500).json({ 
           error: 'PDF cropping failed',
           details: 'Cropping is required for endless roll to determine paper height. ' + cropErr.message
         });
       }
       // For fixed paper, continue with explicit dimensions
     }
   }
   ```

3. **Calculate media dimensions**:
   ```javascript
   let mediaWidthMm, mediaHeightMm;
   const isLandscape = orientation === 'landscape';
   
   if (endlessRoll) {
     // Height from cropped content
     const contentWidth = croppedDimensions?.cropped?.widthMm || 62;
     const contentHeight = croppedDimensions?.cropped?.heightMm || 40;
     
     if (isLandscape) {
       // After 90° rotation: original width becomes the length
       mediaWidthMm = paperWidthMm;
       mediaHeightMm = contentWidth;
     } else {
       mediaWidthMm = paperWidthMm;
       mediaHeightMm = contentHeight;
     }
   } else {
     // Fixed paper size
     if (isLandscape) {
       // Swap for landscape
       mediaWidthMm = paperHeightMm;
       mediaHeightMm = paperWidthMm;
     } else {
       mediaWidthMm = paperWidthMm;
       mediaHeightMm = paperHeightMm;
     }
   }
   ```

4. **Rotate if landscape**:
   ```javascript
   if (orientation === 'landscape') {
     pdfBuffer = await rotatePdf(pdfBuffer, 90);
   }
   ```

5. **Send to CUPS** with explicit dimensions

### Remove old logic:
- Remove `paperFormatName` parsing for endless roll detection
- Remove `prepareForEndlessRoll()` function call (dimensions handled explicitly now)

---

## Part 4: Add Print Scaling to CUPS

**`server/lib/cups-printer.js`**

Add IPP attribute to prevent auto-fit scaling:
```javascript
const jobAttributes = {
  'copies': copies,
  'print-quality': 'normal',
  'print-scaling': 'none',   // Prevent auto-fit - print at 100%
};
```

---

## Part 5: Update Frontend API Calls

**`src/pages/Index.tsx`**

Update the print API call to include new settings:
```javascript
body: JSON.stringify({
  labelId: savedLabel.id,
  cupsUrl: config.printerConfig.cupsUrl,
  printerName: config.printerConfig.printerName,
  orientation: config.printerConfig.orientation,
  cropH: config.printerConfig.cropMarginHorizontal ?? 5,
  cropV: config.printerConfig.cropMarginVertical ?? 5,
  disableCropping: config.printerConfig.disableCropping || false,
  // New explicit paper settings
  paperWidthMm: config.printerConfig.paperWidthMm,
  paperHeightMm: config.printerConfig.paperHeightMm,
  endlessRoll: config.printerConfig.endlessRoll,
})
```

**`src/components/LabelHistory.tsx`**

Update `directPrintConfig` interface and usage to include the new fields.

---

## Summary of All File Changes

| File | Changes |
|------|---------|
| `server/package.json` | Downgrade pdfjs-dist to ^3.11.174 |
| `server/lib/pdf-cropper.js` | Change import to `.js`, add `_createCanvas` method |
| `server/lib/cups-printer.js` | Add `print-scaling: none` attribute |
| `server/routes/api.js` | Read explicit paper settings, calculate dimensions, make cropping mandatory for endless |
| `src/types/shipping.ts` | Add `paperWidthMm`, `paperHeightMm`, `endlessRoll` to PrinterConfig |
| `src/hooks/useConfig.ts` | Add defaults for new fields |
| `src/components/SettingsPanel.tsx` | Add paper width/height inputs and endless roll toggle |
| `src/pages/Index.tsx` | Pass new config fields in print API call |
| `src/components/LabelHistory.tsx` | Pass new config fields in directPrintConfig |

---

## Technical Details

### Print Flow Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load PDF from storage                                        │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Crop PDF and get dimensions                                  │
│    croppedDimensions = { widthMm: 62, heightMm: 35 }           │
│    If fails AND endlessRoll=true → HTTP 500 error              │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Calculate media dimensions                                   │
│                                                                 │
│    ENDLESS + PORTRAIT:                                          │
│      mediaWidth = paperWidthMm (62)                             │
│      mediaHeight = croppedHeight (35)                           │
│                                                                 │
│    ENDLESS + LANDSCAPE:                                         │
│      mediaWidth = paperWidthMm (50)                             │
│      mediaHeight = croppedWidth (62)  ← rotated                │
│                                                                 │
│    FIXED + PORTRAIT:                                            │
│      mediaWidth = paperWidthMm (62)                             │
│      mediaHeight = paperHeightMm (100)                          │
│                                                                 │
│    FIXED + LANDSCAPE:                                           │
│      mediaWidth = paperHeightMm (100)                           │
│      mediaHeight = paperWidthMm (62)  ← swapped                │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Rotate PDF 90° if landscape                                  │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Send to CUPS with:                                           │
│    - media-col: { x-dimension, y-dimension }                   │
│    - print-scaling: none                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Settings UI Layout

```text
Paper Format                          ← For Deutsche Post API (unchanged)
┌─────────────────────────────────────┐
│ [Dropdown: Select paper format]     │
└─────────────────────────────────────┘

Orientation                           ← Applies to all paper types
┌─────────────────────────────────────┐
│ [Portrait ▼]                        │
└─────────────────────────────────────┘
Use Landscape to rotate labels 90°.

─── Paper Size ─────────────────────────

Paper width (mm)
┌─────────────────────────────────────┐
│ 62                                  │
└─────────────────────────────────────┘

Paper height (mm)
┌─────────────────────────────────────┐
│ 100                                 │  ← grayed out when endless=true
└─────────────────────────────────────┘

[✓] Endless roll (height from content)

Height is calculated automatically from
the cropped label when using endless roll.
```

---

## Expected Log Output (Fixed)

```text
[PDFCropper] Page 1: detected content at pixels (45,38)-(412,289) → PDF points (22,19)-(206,144)
[PDFCropper] Page 1: content 184x125 pts → cropped 212x154 pts (5mm/5mm padding)
[Print] PDF cropped to 62.1x35.2mm
[Print] Endless roll portrait: width=62mm, height=35.2mm (from content)
[CUPS] Sending print job to: http://10.0.0.50:631/printers/brotherbrief
[CUPS] Job name: Label label_xxx, PDF size: 8234 bytes
[CUPS] Setting media size: 62.0x35.2mm
[CUPS] Print job submitted, ID: 42
```

---

## Verification After Implementation

1. **Cropping works**: No more "Image or Canvas expected" error - logs show pixel detection
2. **Endless + portrait**: Height matches cropped content (~35mm, not 48mm or 100mm)
3. **Endless + landscape**: Width = roll width, height = cropped width (rotated)
4. **Fixed + portrait**: Uses explicit width/height from settings
5. **Fixed + landscape**: Dimensions are swapped correctly
6. **100% scale**: Physical printout matches PDF dimensions exactly

