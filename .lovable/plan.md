

# Plan: Fix PDF Cropping Issues

## Overview

Two bugs identified in the PDF cropping system:
1. **Duplicate content detection calls** causing 3 log entries per print
2. **Wrong fallback dimensions** causing "cropped" output to be larger than original

---

## Part 1: Fix Duplicate Content Detection Calls

### Problem

In `server/routes/print.js` (lines 49-50), the print route calls both functions sequentially:
```javascript
croppedDimensions = await getContentDimensions(pdfBuffer, cropMarginH, cropMarginV);
pdfBuffer = await cropPdfWithPadding(pdfBuffer, cropMarginH, cropMarginV);
```

Both `getContentDimensions()` and `cropPdfWithPadding()` internally call `getContentBoundsPerPage()`, which does the expensive pixel scanning and logs the detection results. This causes duplicate log entries and wasted processing.

### Solution

Refactor `cropPdfWithPadding()` to return both the cropped PDF buffer AND the dimensions, so we only need one call.

**Changes to `server/lib/pdf-cropper.js`:**

Create a new function `cropPdfWithPaddingAndDimensions()` that returns both:
```javascript
export async function cropPdfWithPaddingAndDimensions(pdfBuffer, paddingHorizontalMm = 5, paddingVerticalMm = 5) {
  const bounds = await getContentBoundsPerPage(pdfBuffer);
  
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const padX = mmToPoints(paddingHorizontalMm);
  const padY = mmToPoints(paddingVerticalMm);
  
  // Get original dimensions
  const originalWidth = pages[0].getWidth();
  const originalHeight = pages[0].getHeight();
  
  // Calculate cropped dimensions from bounds
  const b = bounds[0];
  const croppedWidthPts = (b.maxX - b.minX) + padX * 2;
  const croppedHeightPts = (b.maxY - b.minY) + padY * 2;
  
  // Apply cropping to all pages
  for (let i = 0; i < pages.length; i++) {
    const b = bounds[i];
    const newMinX = b.minX - padX;
    const newMinY = b.minY - padY;
    const newWidth = (b.maxX - b.minX) + padX * 2;
    const newHeight = (b.maxY - b.minY) + padY * 2;
    
    pages[i].setMediaBox(newMinX, newMinY, newWidth, newHeight);
    pages[i].setCropBox(newMinX, newMinY, newWidth, newHeight);
    // ... other boxes
  }
  
  return {
    buffer: Buffer.from(await pdfDoc.save()),
    dimensions: {
      original: {
        widthMm: Math.round(pointsToMm(originalWidth) * 10) / 10,
        heightMm: Math.round(pointsToMm(originalHeight) * 10) / 10
      },
      cropped: {
        widthMm: Math.round(pointsToMm(croppedWidthPts) * 10) / 10,
        heightMm: Math.round(pointsToMm(croppedHeightPts) * 10) / 10
      }
    }
  };
}
```

**Changes to `server/routes/print.js`:**

Replace the two separate calls with one:
```javascript
// Before (two calls, duplicate scanning):
croppedDimensions = await getContentDimensions(pdfBuffer, cropMarginH, cropMarginV);
pdfBuffer = await cropPdfWithPadding(pdfBuffer, cropMarginH, cropMarginV);

// After (one call):
const cropResult = await cropPdfWithPaddingAndDimensions(pdfBuffer, cropMarginH, cropMarginV);
pdfBuffer = cropResult.buffer;
croppedDimensions = cropResult.dimensions;
```

---

## Part 2: Fix "No Content Detected" Fallback

### Problem

When content detection fails (no ink pixels found), the code falls back to the canvas viewport size:
```javascript
results.push({
  minX: 0,
  minY: 0,
  maxX: viewport.width / RENDER_SCALE,
  maxY: viewport.height / RENDER_SCALE
});
```

This is wrong because `viewport.width/height` is the **rendered canvas size in pixels**, not the PDF page size in points. The division by `RENDER_SCALE` gives points, but it's based on the canvas dimensions, not the actual PDF page dimensions.

When content detection fails, the "cropped" output ends up larger than the original because the rendered canvas may be larger than the actual content area.

### Root Cause

The `page.getViewport({ scale: RENDER_SCALE })` returns a viewport that's scaled up for pixel detection. Dividing by `RENDER_SCALE` should give us back the original dimensions, but if the PDF page itself is being rendered at an unexpected size, we get wrong bounds.

Actually, looking more closely: the real issue is that when `hasContent` is false, the scan found **zero ink pixels**. This means the PDF is rendering as a completely white page in the canvas. The QR codes, barcodes, and text aren't being rendered.

### Investigation Needed

The logs show:
```
[PDFCropper] No content detected on page 1 - using full page
[PDFCropper] No content detected on page 1 - using full page
[PDFCropper] Page 1: content 249x136 pts → cropped 266x153 pts
```

Wait - the third line shows content WAS detected (249x136 pts). So the detection is working sometimes but failing on subsequent calls? This is strange.

This could be a pdfjs-dist caching or canvas state issue. Let me propose a more defensive fix.

### Solution

1. **Add debug logging** to understand when detection fails
2. **Use actual PDF page dimensions** for fallback instead of viewport
3. **Return the original page bounds** when content isn't detected (skip cropping for that page)

**Changes to `server/lib/pdf-cropper.js`:**

Fix the fallback to use actual PDF page dimensions:
```javascript
// In getContentBoundsPerPage(), store actual page size
const actualPageWidthPts = viewport.width / RENDER_SCALE;
const actualPageHeightPts = viewport.height / RENDER_SCALE;

// Fallback if no content detected - return actual page bounds (no cropping)
if (!hasContent) {
  console.warn('[PDFCropper] No content detected on page', pageNum, 
    `- using full page (${Math.round(actualPageWidthPts)}x${Math.round(actualPageHeightPts)} pts)`);
  results.push({
    minX: 0,
    minY: 0,
    maxX: actualPageWidthPts,
    maxY: actualPageHeightPts,
    fallback: true  // Flag to indicate detection failed
  });
}
```

Add a check in `cropPdfWithPadding` to skip cropping when fallback is used:
```javascript
for (let i = 0; i < pages.length; i++) {
  const b = bounds[i];
  
  // If detection failed, don't apply cropping - keep original page size
  if (b.fallback) {
    console.log(`[PDFCropper] Page ${i + 1}: detection failed, keeping original size`);
    continue;
  }
  
  // ... normal cropping logic
}
```

---

## Part 3: Add Debug Info for Rendering Issues

### Problem

We need to understand why content detection sometimes fails. Add logging to help diagnose.

### Solution

Add logging in the pixel scan to show what was found:
```javascript
console.log(`[PDFCropper] Page ${pageNum}: canvas ${width}x${height}px, found ${totalInk} ink pixels`);
```

This will help identify if the issue is:
- Canvas rendering failing (0 ink pixels)
- White threshold too high (few ink pixels)
- Row/column thresholds filtering out valid content

---

## Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `server/lib/pdf-cropper.js` | Add `cropPdfWithPaddingAndDimensions()` | Single call returns both buffer and dimensions |
| `server/lib/pdf-cropper.js` | Fix fallback to use actual page size | Prevent "cropped" being larger than original |
| `server/lib/pdf-cropper.js` | Add `fallback` flag to bounds | Skip cropping when detection fails |
| `server/lib/pdf-cropper.js` | Add debug logging for ink pixel count | Help diagnose rendering issues |
| `server/routes/print.js` | Use new combined function | Eliminate duplicate scans |

---

## Technical Details

### Why Detection Might Fail

Several possibilities:
1. **pdfjs-dist not rendering embedded images** - QR codes/barcodes might not render in headless mode
2. **Canvas context issue** - The `node-canvas` context might not be compatible with pdfjs rendering
3. **PDF structure** - DHL labels might use unusual PDF features that don't render in legacy pdfjs

### Defensive Approach

Rather than trying to fix rendering, we take a defensive approach:
1. When detection fails, DON'T crop (keep original size)
2. Log detailed info so we can diagnose
3. For endless roll, if detection fails and no crop dimensions are available, fall back to explicit paper dimensions or error clearly

---

## Files to Modify

| File | Action |
|------|--------|
| `server/lib/pdf-cropper.js` | Add combined function, fix fallback, add logging |
| `server/routes/print.js` | Use combined function |

