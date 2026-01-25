
# Plan: Fix PDF.js Worker Path Resolution

## Problem

The path resolution for `pdfjs-dist` resources is incorrect in the Docker container:

**In Development (server/ directory):**
- File: `server/lib/pdf-cropper.js`
- `__dirname` = `.../server/lib`
- `../../node_modules` = `.../node_modules` (works if running from project root)

**In Docker Container:**
- File copied to: `/app/lib/pdf-cropper.js`
- `__dirname` = `/app/lib`
- `../../node_modules` = `/node_modules` (WRONG - doesn't exist!)
- Actual location: `/app/node_modules`

## Solution

Use `../node_modules` instead of `../../node_modules` to match the Docker container structure where `server/` contents are copied directly to `/app/`.

---

## Changes

### File: `server/lib/pdf-cropper.js`

Update the three path.resolve() calls from `../../node_modules` to `../node_modules`:

```javascript
// Before (lines 13-21):
GlobalWorkerOptions.workerSrc = path.resolve(
  __dirname,
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.js'
);
const CMAP_URL = path.resolve(__dirname, '../../node_modules/pdfjs-dist/cmaps/');
const STANDARD_FONT_DATA_URL = path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts/');

// After:
GlobalWorkerOptions.workerSrc = path.resolve(
  __dirname,
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.js'
);
const CMAP_URL = path.resolve(__dirname, '../node_modules/pdfjs-dist/cmaps/');
const STANDARD_FONT_DATA_URL = path.resolve(__dirname, '../node_modules/pdfjs-dist/standard_fonts/');
```

---

## Why This Works

In the Docker container:
- `__dirname` = `/app/lib`
- `../node_modules` = `/app/node_modules` (correct!)

The server's `node_modules` is installed at `/app/node_modules` via `npm install` in the Dockerfile (line 15), and the lib folder is at `/app/lib` (from copying `server/` to `/app/`).

---

## Technical Details

| Path Component | Docker Value |
|----------------|--------------|
| WORKDIR | `/app` |
| `pdf-cropper.js` location | `/app/lib/pdf-cropper.js` |
| `__dirname` | `/app/lib` |
| `../node_modules` | `/app/node_modules` |
| pdfjs-dist worker | `/app/node_modules/pdfjs-dist/legacy/build/pdf.worker.js` |
