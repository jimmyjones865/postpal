
## What’s actually causing the “60 ink pixels” result

In `server/lib/pdf-cropper.js`, the scan loop uses:

- `width = viewport.width` and `height = viewport.height` (both **floating point**, e.g. `498.896`)
- pixel indexing: `idx = (y * width + x) * 4`

When `y > 0`, `y * width` becomes a float, so `idx` becomes a float.  
Accessing `pixels[idx]` with a float index returns `undefined`, so almost no pixels are ever counted as “ink”.

The only row that still works is `y = 0` (because `0 * width` is `0`, producing integer indices). That perfectly explains why you see a small non-zero number like **60**: you’re effectively scanning only the first row of the canvas.

So the main fix is: **always scan using integer canvas dimensions** and compute indices using those integers.

---

## Implementation changes

### 1) Fix pixel scanning to use integer canvas dimensions (core fix)
**File:** `server/lib/pdf-cropper.js`

**Change approach:**
- Keep using `viewport = page.getViewport({ scale: RENDER_SCALE })` for rendering.
- Create an integer-backed canvas size:
  - `const canvasWidth = Math.ceil(viewport.width)`
  - `const canvasHeight = Math.ceil(viewport.height)`
- Use `canvasWidth/canvasHeight` everywhere for:
  - `createCanvas()`
  - `fillRect()`
  - `getImageData()`
  - scan loops
  - typed array sizes (`rowInk`, `colInk`)
  - index calculation `idx = (y * canvasWidth + x) * 4`

**Why `Math.ceil` and not `Math.floor`:**
- Avoids clipping the rendered content at the right/bottom edge when viewport size is fractional.

**Also update the log** to show both viewport and integer canvas dimensions so future debugging is straightforward.

Expected result: ink pixel counts should jump from ~60 to many thousands for a real label.

---

### 2) Fix endless-roll fallback height to use original PDF height (your chosen behavior)
Right now `server/routes/print.js` still falls back to `paperHeightMm || 100` in the endless-roll branch, which is why you see:

`[Print] Using fallback dimensions: 88x100mm`

**File:** `server/routes/print.js`

**Change approach:**
- In the endless roll sizing logic, prefer:
  1) `croppedDimensions.cropped` if available
  2) otherwise `croppedDimensions.original` (even when detection failed / fallback happened)
  3) only then fall back to explicit/default

Concretely: remove the `&& !cropFailed` guard so original dimensions are used when detection fails.

This ensures:
- if content detection fails, you still print using the original PDF height (not 100mm).
- matches your stated preference for crop-fail behavior.

---

### 3) (Optional but recommended) Add a “scan sanity” retry when ink exists but bounds fail
After the integer-dimension fix, this may not be needed, but it’s a good robustness improvement:

**File:** `server/lib/pdf-cropper.js`

If `totalInk > 0` but `hasContent` is false due to row/column thresholds, do one more pass with `rowThreshold=1` / `colThreshold=1` to recover sparse content (thin lines, faint barcodes).

This is a safety net and shouldn’t affect normal labels.

---

## Validation steps (how we’ll confirm it’s fixed)

1) Re-run the exact “Print from history” case with the provided label.
2) Confirm backend logs show something like:
   - `canvas <int>x<int> ... found <large number> ink pixels`
3) Confirm that for endless roll:
   - `mediaHeightMm` uses the detected cropped height
   - or, if detection fails, uses `croppedDimensions.original.heightMm` (not 100mm)

---

## Files to update

1) `server/lib/pdf-cropper.js`
   - Use integer canvas sizes and integer indexing for scan loops
   - (Optional) add minimal retry for sparse ink
2) `server/routes/print.js`
   - endless roll fallback: use original PDF height whenever cropping detection fails

