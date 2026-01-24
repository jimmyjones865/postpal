
# Plan: Simplify PDF Cropper to Pixel-Based Detection

## Overview

Replace the complex operator parsing logic (~130 lines) with a simpler pixel-scanning approach. Since Deutsche Post labels are always black and white, we can render each PDF page to a canvas and scan for any non-white pixels to find the exact content bounding box.

## How It Works

```text
+---------------------------+       +---------------------------+
|  Original PDF Page        |       |  Rendered to Canvas       |
|  (with all white space)   |  -->  |  (as pixel data)          |
+---------------------------+       +---------------------------+
                                               |
                                               v
                                    +---------------------------+
                                    |  Scan pixels for non-white|
                                    |  (R,G,B not all 255)      |
                                    +---------------------------+
                                               |
                                               v
                                    +---------------------------+
                                    |  Content bounds found:    |
                                    |  minX, minY, maxX, maxY   |
                                    +---------------------------+
                                               |
                                               v
                                    +---------------------------+
                                    |  Apply uniform padding    |
                                    |  and set PDF boxes        |
                                    +---------------------------+
```

## Benefits

1. **Simpler code**: ~30 lines vs ~130 lines
2. **Pixel-perfect detection**: Catches ALL visible content regardless of how the PDF is structured
3. **No edge cases**: Text, images, vectors, barcodes - if it's visible, it will be detected
4. **More robust**: No complex matrix transformations or operator parsing

## Changes

### 1. Add canvas dependency to server

Install `canvas` package which provides Node.js canvas API compatible with pdfjs-dist:

**File**: `server/package.json`
- Add `"canvas": "^2.11.2"` to dependencies

### 2. Rewrite content detection function

**File**: `server/lib/pdf-cropper.js`

Replace the entire `getContentBoundsPerPage` function and remove all the matrix helper functions. The new implementation will:

1. Load PDF with pdfjs-dist
2. For each page:
   - Get viewport at a reasonable scale (2x for accuracy)
   - Create a canvas matching the viewport size
   - Render the page to canvas
   - Get pixel data from canvas
   - Scan all pixels to find min/max X and Y where color is not white
   - Convert pixel coordinates back to PDF points
3. Return bounds per page

**New logic** (pseudocode):
```javascript
async function getContentBoundsPerPage(pdfBuffer) {
  const pdf = await getDocument({ data, disableFontFace: true }).promise;
  const results = [];
  
  for each page:
    // Render at 2x scale for accuracy
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    
    // Fill with white first
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    
    // Render PDF page
    await page.render({ canvasContext: ctx, viewport }).promise;
    
    // Scan pixels for non-white content
    const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height);
    const { data, width, height } = imageData;
    
    let minX = width, minY = height, maxX = 0, maxY = 0;
    
    for each pixel (x, y):
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      
      // If not white (allowing small tolerance for anti-aliasing)
      if (r < 250 || g < 250 || b < 250):
        minX = min(minX, x);
        minY = min(minY, y);
        maxX = max(maxX, x);
        maxY = max(maxY, y);
    
    // Convert back to PDF points (divide by scale)
    results.push({
      minX: minX / scale,
      minY: (height - maxY) / scale,  // PDF Y is inverted
      maxX: maxX / scale,
      maxY: (height - minY) / scale
    });
  
  return results;
}
```

### 3. Keep cropping logic unchanged

The `cropPdfWithPadding` function remains exactly the same - it receives bounds and applies padding. Only the detection method changes.

## Technical Details

- **Render scale**: 2x provides good accuracy without excessive memory usage
- **White threshold**: 250 instead of 255 to handle anti-aliased edges
- **Y-axis inversion**: PDF coordinates have origin at bottom-left, canvas at top-left
- **Memory**: Canvas is created/destroyed per page to avoid memory buildup
- **Original file integrity**: Unchanged - we still load a fresh copy for modification

## Files Modified

| File | Change |
|------|--------|
| `server/package.json` | Add `canvas` dependency |
| `server/lib/pdf-cropper.js` | Replace operator parsing with pixel scanning |

## Testing

After implementation, the cropper can be tested by:
1. Printing a label with cropping enabled
2. Checking console logs for detected content dimensions
3. Verifying the printed label has uniform padding around all content
