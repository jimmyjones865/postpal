
# Plan: Fix Dynamic Page Height for Endless Roll Printing

## Problem

Currently, even though the PDF is correctly sized based on the cropped content, CUPS ignores the PDF's embedded MediaBox dimensions and uses its configured default paper size. This results in fixed-height printouts with extra whitespace on endless roll paper.

## Solution

Send explicit **IPP media attributes** (`media-col`) to CUPS that specify the exact page dimensions in hundredths of millimeters. This tells CUPS precisely what size paper to use, overriding any defaults.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  POST /api/print                                                │
├─────────────────────────────────────────────────────────────────┤
│  1. Crop PDF (existing)                                         │
│  2. Prepare for endless roll → returns dimensions               │
│  3. Pass dimensions to sendToCups()     ◄── NEW                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  sendToCups(pdfBuffer, cupsUrl, printerName, options)           │
├─────────────────────────────────────────────────────────────────┤
│  options.mediaWidthMm   ◄── NEW: Page width in mm               │
│  options.mediaHeightMm  ◄── NEW: Page height in mm              │
│                                                                 │
│  If dimensions provided, add to job-attributes-tag:             │
│    'media-col': {                                               │
│      'media-size': {                                            │
│        'x-dimension': widthMm * 100,   (hundredths of mm)       │
│        'y-dimension': heightMm * 100                            │
│      }                                                          │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Changes

### 1. Update `sendToCups` to Accept Media Dimensions

**File**: `server/lib/cups-printer.js`

Add optional `mediaWidthMm` and `mediaHeightMm` parameters to the options object. When provided, include the `media-col` attribute in the IPP job request:

```javascript
export async function sendToCups(pdfBuffer, cupsUrl, printerName, options = {}) {
  const { 
    jobName = 'Shipping Label', 
    copies = 1,
    mediaWidthMm,    // NEW
    mediaHeightMm    // NEW
  } = options;
  
  const jobAttributes = {
    'copies': copies,
    'print-quality': 'normal'
  };
  
  // If explicit dimensions provided, tell CUPS the exact page size
  if (mediaWidthMm && mediaHeightMm) {
    jobAttributes['media-col'] = {
      'media-size': {
        'x-dimension': Math.round(mediaWidthMm * 100),  // hundredths of mm
        'y-dimension': Math.round(mediaHeightMm * 100)
      }
    };
    console.log(`[CUPS] Setting media size: ${mediaWidthMm}x${mediaHeightMm}mm`);
  }
  
  // ... rest of function
}
```

### 2. Pass Dimensions from Print Endpoint

**File**: `server/routes/api.js`

After preparing the PDF for endless roll printing, pass the calculated dimensions to `sendToCups`:

```javascript
let mediaWidthMm, mediaHeightMm;

if (isEndless && rollWidthMm) {
  const isLandscape = orientation === 'landscape';
  const result = await prepareForEndlessRoll(pdfBuffer, rollWidthMm, isLandscape);
  pdfBuffer = result.buffer;
  
  // Set dimensions for IPP media-col attribute
  if (isLandscape) {
    mediaWidthMm = result.contentHeightMm;  // After rotation, height becomes width
    mediaHeightMm = rollWidthMm;
  } else {
    mediaWidthMm = rollWidthMm;
    mediaHeightMm = result.contentHeightMm;
  }
}

// Send to CUPS with explicit dimensions
const printResult = await sendToCups(pdfBuffer, cupsUrl, printerName, {
  jobName: `Label ${label.id}`,
  mediaWidthMm,
  mediaHeightMm
});
```

## Technical Details

| Attribute | Purpose |
|-----------|---------|
| `media-col` | IPP collection attribute for detailed media specification |
| `media-size.x-dimension` | Page width in hundredths of millimeters (e.g., 8800 = 88mm) |
| `media-size.y-dimension` | Page height in hundredths of millimeters |

The dimensions are calculated from the cropped content:
- **Portrait**: width = roll width, height = cropped content height + padding
- **Landscape**: width = cropped content height, height = roll width

## Files to Modify

| File | Changes |
|------|---------|
| `server/lib/cups-printer.js` | Add `mediaWidthMm`/`mediaHeightMm` options, build `media-col` attribute |
| `server/routes/api.js` | Calculate and pass media dimensions to `sendToCups` |

## Expected Behavior After Fix

1. Print a label on endless roll paper
2. The printout height matches the cropped content + padding margins
3. No extra whitespace at top/bottom
4. CUPS uses the exact dimensions specified, not its default media size
