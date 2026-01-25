
# Implementation Plan: Fixes and 4-Direction Cropping

## Overview

This plan addresses four items:
1. PDF viewer toolbar still visible (switch to `<embed>` tag)
2. ID copy button not clickable (add `type="button"` and enhance animation)
3. CUPS incorrectly treating "successful-ok" as error (fix string status handling)
4. Add 4-direction independent crop margins (top, right, bottom, left)

---

## Fix 1: PDF Viewer Toolbar

**Problem**: The `#toolbar=0` URL fragment is browser-dependent and doesn't work consistently.

**Solution**: Replace `<iframe>` with `<embed type="application/pdf">` for better cross-browser toolbar hiding.

**File**: `src/components/LabelResult.tsx` (lines 140-146)

```tsx
// Before
<iframe 
  src={pdfUrl}
  className="w-full rounded border border-border bg-white"
  style={previewStyle}
  title="Purchased Label PDF"
/>

// After
<embed 
  src={pdfUrl}
  type="application/pdf"
  className="w-full rounded border border-border bg-white"
  style={previewStyle}
/>
```

---

## Fix 2: ID Copy Button

**Problem**: Button may not be responding correctly; animation not visible enough.

**Solution**: 
1. Add explicit `type="button"` to prevent form interference
2. Increase animation duration and contrast

**File**: `src/components/LabelResult.tsx` (line 182-199)

```tsx
<button
  type="button"  // Add explicit type
  onClick={handleCopyId}
  ...
>
```

**File**: `src/index.css` - Enhance flash animation

```css
@keyframes flash-copy {
  0% { background-color: hsl(var(--muted) / 0.5); }
  30% { background-color: hsl(var(--primary) / 0.7); }
  100% { background-color: hsl(var(--muted) / 0.5); }
}

.animate-flash {
  animation: flash-copy 0.4s ease;
}
```

---

## Fix 3: CUPS Status Code Parsing

**Problem**: The IPP library returns `statusCode` as a string like `"successful-ok"`, but the code compares it numerically.

**File**: `server/lib/cups-printer.js` (lines 58-76)

```javascript
// Before
const statusCode = res.statusCode;
if (statusCode !== undefined && statusCode <= 0x00FF) {
  // success
} else {
  // error - but "successful-ok" ends up here!
}

// After
const statusCode = res.statusCode;
logger.debug('[CUPS] Response status:', statusCode, res['status-message']);

// IPP success: numeric codes 0x0000-0x00FF OR string starting with "successful"
const isSuccess = 
  (typeof statusCode === 'number' && statusCode <= 0x00FF) ||
  (typeof statusCode === 'string' && statusCode.startsWith('successful'));

if (isSuccess) {
  const jobId = res['job-attributes-tag']?.['job-id'];
  logger.info('[CUPS] Print job submitted, ID:', jobId);
  resolve({ success: true, jobId });
} else {
  const errorMsg = res['status-message'] || `IPP error: ${statusCode}`;
  logger.error('[CUPS] Print failed:', errorMsg);
  resolve({ success: false, error: errorMsg });
}
```

---

## Fix 4: 4-Direction Independent Cropping

Replace the current 2-axis cropping (horizontal/vertical) with 4 independent margins (top, right, bottom, left).

### 4.1 Update Type Definitions

**File**: `src/types/shipping.ts` - Replace crop margins in PrinterConfig

```typescript
export interface PrinterConfig {
  // ... existing fields ...
  
  // Replace these two:
  // cropMarginHorizontal: number;
  // cropMarginVertical: number;
  
  // With four independent margins:
  cropMarginTop: number;     // mm
  cropMarginRight: number;   // mm
  cropMarginBottom: number;  // mm
  cropMarginLeft: number;    // mm
  
  // ... rest unchanged ...
}
```

### 4.2 Update PrintOptions Interface

**File**: `src/lib/printConfig.ts`

```typescript
export interface PrintOptions {
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
}

export function buildPrintOptions(config: PrinterConfig): PrintOptions {
  return {
    cropTop: config.cropMarginTop ?? 5,
    cropRight: config.cropMarginRight ?? 5,
    cropBottom: config.cropMarginBottom ?? 5,
    cropLeft: config.cropMarginLeft ?? 5
  };
}
```

### 4.3 Update PrintParams Interface

**File**: `src/services/labelService.ts`

```typescript
export interface PrintParams {
  labelId: string;
  cupsUrl: string;
  printerName: string;
  orientation: 'portrait' | 'landscape';
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  disableCropping: boolean;
  paperWidthMm: number;
  paperHeightMm: number;
  endlessRoll: boolean;
}

export function buildPrintParams(
  labelId: string, 
  config: DirectPrintConfig,
  cropMargins: { top: number; right: number; bottom: number; left: number }
): PrintParams {
  return {
    labelId,
    cupsUrl: config.cupsUrl,
    printerName: config.printerName,
    orientation: config.orientation,
    cropTop: cropMargins.top,
    cropRight: cropMargins.right,
    cropBottom: cropMargins.bottom,
    cropLeft: cropMargins.left,
    disableCropping: config.disableCropping,
    paperWidthMm: config.paperWidthMm,
    paperHeightMm: config.paperHeightMm,
    endlessRoll: config.endlessRoll
  };
}

export async function downloadLabel(
  labelId: string, 
  cropTop: number, 
  cropRight: number, 
  cropBottom: number, 
  cropLeft: number
): Promise<void> {
  const pdfUrl = `${API_BASE}/labels/${labelId}/pdf?print=1&cropTop=${cropTop}&cropRight=${cropRight}&cropBottom=${cropBottom}&cropLeft=${cropLeft}`;
  // ... rest unchanged
}
```

### 4.4 Update Backend PDF Cropper

**File**: `server/lib/pdf-cropper.js`

Update `cropPdfWithPadding` function signature:

```javascript
export async function cropPdfWithPadding(
  pdfBuffer,
  paddingTop = 5,
  paddingRight = 5,
  paddingBottom = 5,
  paddingLeft = 5
) {
  const bounds = await getContentBoundsPerPage(pdfBuffer);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  const padTop = mmToPoints(paddingTop);
  const padRight = mmToPoints(paddingRight);
  const padBottom = mmToPoints(paddingBottom);
  const padLeft = mmToPoints(paddingLeft);

  for (let i = 0; i < pages.length; i++) {
    const b = bounds[i];
    if (b.fallback) continue;

    // Asymmetric padding: each side independent
    const newMinX = b.minX - padLeft;
    const newMinY = b.minY - padBottom;  // PDF Y-axis: bottom padding
    const newWidth = (b.maxX - b.minX) + padLeft + padRight;
    const newHeight = (b.maxY - b.minY) + padTop + padBottom;

    pages[i].setMediaBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setCropBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setTrimBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setBleedBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setArtBox(newMinX, newMinY, newWidth, newHeight);
  }

  return Buffer.from(await pdfDoc.save());
}
```

Also update `cropPdfWithPaddingAndDimensions` and `getContentDimensions` with same 4-parameter signature.

### 4.5 Update Backend Routes

**File**: `server/routes/print.js`

```javascript
const { 
  labelId, cupsUrl, printerName, orientation, 
  cropTop, cropRight, cropBottom, cropLeft,
  disableCropping,
  paperWidthMm, paperHeightMm, endlessRoll
} = req.body;

// Use 4 margins (default to 5mm each)
const marginTop = parseFloat(cropTop) || 5;
const marginRight = parseFloat(cropRight) || 5;
const marginBottom = parseFloat(cropBottom) || 5;
const marginLeft = parseFloat(cropLeft) || 5;

// Pass to cropper
const cropResult = await cropPdfWithPaddingAndDimensions(
  pdfBuffer, 
  marginTop, marginRight, marginBottom, marginLeft
);
```

### 4.6 Update Settings Panel UI

**File**: `src/components/SettingsPanel.tsx` (lines 373-410)

Replace the 2-input grid with a 4-input layout:

```
┌─────────────────────────────────┐
│ Crop Margins (mm)               │
│                                 │
│         ┌───────┐              │
│         │ Top   │              │
│         │   5   │              │
│         └───────┘              │
│  ┌───────┐       ┌───────┐    │
│  │ Left  │       │ Right │    │
│  │   5   │       │   5   │    │
│  └───────┘       └───────┘    │
│         ┌───────┐              │
│         │Bottom │              │
│         │   5   │              │
│         └───────┘              │
└─────────────────────────────────┘
```

```tsx
<div className="grid grid-cols-3 gap-2 items-center">
  {/* Top - centered */}
  <div />
  <div className="config-field">
    <Label className="config-label text-xs text-center">Top</Label>
    <Input
      type="number"
      min={0}
      max={50}
      value={config.printerConfig.cropMarginTop ?? 5}
      onChange={e => onUpdatePrinterConfig({ cropMarginTop: parseInt(e.target.value) || 0 })}
      className="h-9 text-sm text-center"
    />
  </div>
  <div />
  
  {/* Left and Right */}
  <div className="config-field">
    <Label className="config-label text-xs text-center">Left</Label>
    <Input
      type="number"
      min={0}
      max={50}
      value={config.printerConfig.cropMarginLeft ?? 5}
      onChange={e => onUpdatePrinterConfig({ cropMarginLeft: parseInt(e.target.value) || 0 })}
      className="h-9 text-sm text-center"
    />
  </div>
  <div className="flex items-center justify-center">
    <Ruler className="w-6 h-6 text-muted-foreground" />
  </div>
  <div className="config-field">
    <Label className="config-label text-xs text-center">Right</Label>
    <Input
      type="number"
      min={0}
      max={50}
      value={config.printerConfig.cropMarginRight ?? 5}
      onChange={e => onUpdatePrinterConfig({ cropMarginRight: parseInt(e.target.value) || 0 })}
      className="h-9 text-sm text-center"
    />
  </div>
  
  {/* Bottom - centered */}
  <div />
  <div className="config-field">
    <Label className="config-label text-xs text-center">Bottom</Label>
    <Input
      type="number"
      min={0}
      max={50}
      value={config.printerConfig.cropMarginBottom ?? 5}
      onChange={e => onUpdatePrinterConfig({ cropMarginBottom: parseInt(e.target.value) || 0 })}
      className="h-9 text-sm text-center"
    />
  </div>
  <div />
</div>
```

### 4.7 Update Component Consumers

**File**: `src/components/LabelResult.tsx` - Update print/download calls

```tsx
const handleDownload = async () => {
  if (!purchasedLabelId) return;
  setIsDownloading(true);
  try {
    await downloadLabel(
      purchasedLabelId, 
      printOptions.cropTop ?? 5,
      printOptions.cropRight ?? 5,
      printOptions.cropBottom ?? 5,
      printOptions.cropLeft ?? 5
    );
  } finally {
    setIsDownloading(false);
  }
};

const handlePrint = async () => {
  if (!purchasedLabelId) return;
  setIsPrinting(true);
  try {
    if (directPrintConfig.enableDirectPrint && directPrintConfig.cupsUrl) {
      const params = buildPrintParams(purchasedLabelId, directPrintConfig, {
        top: printOptions.cropTop ?? 5,
        right: printOptions.cropRight ?? 5,
        bottom: printOptions.cropBottom ?? 5,
        left: printOptions.cropLeft ?? 5
      });
      await printLabelDirect(params);
    } else {
      await printLabel(purchasedLabelId, printOptions);
    }
  } finally {
    setIsPrinting(false);
  }
};
```

**File**: `src/components/DimensionsPreview.tsx` - Update props to accept 4 margins

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/LabelResult.tsx` | Use `<embed>` tag; add `type="button"`; update print/download calls |
| `src/index.css` | Enhance flash animation |
| `server/lib/cups-printer.js` | Fix string status code handling |
| `src/types/shipping.ts` | Replace 2 crop margins with 4 |
| `src/lib/printConfig.ts` | Update PrintOptions interface |
| `src/services/labelService.ts` | Update PrintParams and functions |
| `server/lib/pdf-cropper.js` | Update all functions for 4-direction padding |
| `server/routes/print.js` | Accept 4 crop parameters |
| `src/components/SettingsPanel.tsx` | 4-input crop margin UI |
| `src/components/DimensionsPreview.tsx` | Update props |

---

## Implementation Order

1. **CUPS fix** (5 min) - Critical, currently blocking printing
2. **Copy button fix** (5 min) - Quick UX improvement  
3. **PDF embed tag** (5 min) - Toolbar visibility fix
4. **4-direction cropping** (40 min) - Larger feature, touches multiple files
