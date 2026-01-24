

# Plan: Implement CUPS IPP Direct Printing

## Overview

Implement direct printing to a CUPS server via the IPP protocol, with smart product defaults, print/download toggle, orientation control, and dynamic page sizing for endless roll paper.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                │
├─────────────────────────────────────────────────────────────────┤
│  AddressInput                                                   │
│  ├─ Print/Download toggle (new)                                 │
│  └─ Ctrl+Enter → auto-select product if none selected           │
│                                                                 │
│  Settings → Printer Tab                                         │
│  ├─ CUPS Server URL (new field)                                 │
│  └─ Enable Direct Print checkbox (new)                          │
│                                                                 │
│  Index.tsx                                                      │
│  └─ handlePrint logic branches on print vs download             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                 │
├─────────────────────────────────────────────────────────────────┤
│  POST /api/print                                                │
│  ├─ Receives: labelId, cupsUrl, printerName, orientation,       │
│  │            paperFormat, cropMargins                          │
│  ├─ Crops PDF (existing logic)                                  │
│  ├─ Rotates if landscape orientation                            │
│  ├─ Sets page size for roll paper (uses content height)         │
│  └─ Sends to CUPS via IPP protocol                              │
└─────────────────────────────────────────────────────────────────┘
```

## Detailed Changes

### 1. Update PrinterConfig Type

**File**: `src/types/shipping.ts`

Add new fields to `PrinterConfig`:
- `cupsUrl: string` - CUPS server URL (e.g., `http://192.168.1.100:631`)
- `enableDirectPrint: boolean` - Toggle for direct IPP vs download

### 2. Update useConfig Hook

**File**: `src/hooks/useConfig.ts`

Add default values:
- `cupsUrl: ''`
- `enableDirectPrint: false`

### 3. Add Print/Download Toggle to AddressInput

**File**: `src/components/AddressInput.tsx`

Add a toggle switch below the textarea with two options:
- "Print" (printer icon) - sends to CUPS directly
- "Download" (download icon) - downloads cropped PDF

New props:
- `printMode: 'print' | 'download'`
- `onPrintModeChange: (mode) => void`

### 4. Update Settings Panel

**File**: `src/components/SettingsPanel.tsx`

Add to Printer tab:
- **CUPS Server URL** input field with placeholder `http://192.168.1.100:631`
- **Enable Direct Print** checkbox
- Helper text explaining the feature

### 5. Add Default Product Selection Logic

**File**: `src/pages/Index.tsx`

When Ctrl+Enter is pressed without a product selected:
1. Check if recipient country is Germany (or empty/DE/Deutschland)
2. Select domestic standard letter if Germany
3. Select international standard letter if not Germany
4. Look for products with `domestic: true/false` and `group: 'standard'`

### 6. Add IPP Dependency

**File**: `server/package.json`

Add: `"ipp": "^3.0.0"`

### 7. Create IPP Print Utility

**File**: `server/lib/cups-printer.js` (new file)

```javascript
// Sends print job to CUPS via IPP protocol
export async function sendToCups(pdfBuffer, cupsUrl, printerName, options) {
  // - Builds IPP Print-Job request
  // - Handles connection errors gracefully
  // - Returns job ID on success
}
```

### 8. Add PDF Rotation Function

**File**: `server/lib/pdf-cropper.js`

Add new export:
```javascript
export async function rotatePdf(pdfBuffer, degrees) {
  // Uses pdf-lib to rotate page 90° for landscape
  // Swaps MediaBox dimensions appropriately
}
```

### 9. Create Backend Print Endpoint

**File**: `server/routes/api.js`

New route: `POST /api/print`

Request body:
```javascript
{
  labelId: string,
  cupsUrl: string,
  printerName: string,
  orientation: 'portrait' | 'landscape',
  paperFormat: { name: string, widthMm: number, isEndless: boolean },
  cropH: number,
  cropV: number
}
```

Logic:
1. Load label PDF from storage
2. Crop PDF using existing `cropPdfWithPadding`
3. If `orientation === 'landscape'`: rotate page 90 degrees
4. If `isEndless`: set page width to roll width, height to cropped content height
5. Send to CUPS via IPP

### 10. Update Frontend Print Flow

**File**: `src/pages/Index.tsx`

Modify `handlePrint`:
- If `printMode === 'download'`: download the cropped PDF (existing flow)
- If `printMode === 'print'` and `enableDirectPrint` and `cupsUrl`: call `/api/print` endpoint
- Fallback: download if direct print not configured

### 11. Update LabelHistory for Print Mode

**File**: `src/components/LabelHistory.tsx`

Update print button to use the new direct print API when direct printing is enabled.

## Endless Roll Paper Logic

For formats with "Endlos" in the name:

1. **Width**: Fixed at the roll width (e.g., 88mm)
2. **Height**: Calculated from cropped content height

```javascript
if (isEndless) {
  const rollWidthPts = mmToPoints(paperFormat.widthMm);
  const contentHeightPts = croppedPage.getHeight();
  
  if (orientation === 'landscape') {
    page.setRotation(degrees(90));
    page.setMediaBox(0, 0, contentHeightPts, rollWidthPts);
  } else {
    page.setMediaBox(0, 0, rollWidthPts, contentHeightPts);
  }
}
```

## Files to Modify/Create

| File | Action | Description |
|------|--------|-------------|
| `src/types/shipping.ts` | Modify | Add `cupsUrl`, `enableDirectPrint` to PrinterConfig |
| `src/hooks/useConfig.ts` | Modify | Add defaults for new config fields |
| `src/components/AddressInput.tsx` | Modify | Add print/download toggle |
| `src/components/SettingsPanel.tsx` | Modify | Add CUPS URL and direct print settings |
| `src/pages/Index.tsx` | Modify | Default product selection, print mode handling |
| `src/components/LabelHistory.tsx` | Modify | Use direct print when enabled |
| `server/package.json` | Modify | Add `ipp` dependency |
| `server/routes/api.js` | Modify | Add `/api/print` endpoint |
| `server/lib/cups-printer.js` | Create | IPP printing utility |
| `server/lib/pdf-cropper.js` | Modify | Add rotation function |

## Error Handling

- CUPS connection failures: Show toast with error message
- Printer not found: Clear error suggesting to check printer name
- PDF processing errors: Fallback to download with warning
- Missing CUPS URL: Prompt user to configure in settings

