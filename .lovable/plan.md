
# Plan: Codebase Modernization

## Overview

This plan addresses cleanup and modernization opportunities to improve code consistency and maintainability.

---

## Part 1: Remove Unused CSS

### Problem
`src/App.css` contains 42 lines of Vite boilerplate CSS (logo animations, `.card`, `.read-the-docs`) that are not used anywhere. The app uses Tailwind for all styling.

### Changes

**Delete file**: `src/App.css`

**Update `src/App.tsx`**: Remove the import for `App.css` if present.

---

## Part 2: Remove Deprecated Functions

### Problem
`server/lib/pdf-cropper.js` contains two deprecated legacy functions that are just wrappers:
- `cropPdfWhitespace()` - alias for `cropPdfWithPadding()`
- `smartCropPdf()` - alias for `cropPdfWithPadding()`

These add confusion and should be removed since they're not needed (the codebase uses `cropPdfWithPadding` directly).

### Changes

**File: `server/lib/pdf-cropper.js`**
- Remove the `cropPdfWhitespace` function (lines 290-296)
- Remove the `smartCropPdf` function (lines 301-307)

**File: `server/routes/api.js`**
- Update import to remove `cropPdfWhitespace` reference
- The existing usage at line 359 calls `cropPdfWhitespace` for the `/labels/:id/pdf` GET route - change to `cropPdfWithPadding`

---

## Part 3: Consistent Button Styling in AddressInput

### Problem
The print/download toggle in `AddressInput.tsx` uses inline Tailwind classes instead of reusing existing UI component patterns. This works fine but is inconsistent with the rest of the codebase.

### Changes

**File: `src/components/AddressInput.tsx`**
- Extract the toggle into a reusable pattern or simplify using existing Tailwind classes more cleanly
- Minor improvement: group the toggle styling classes for better readability

This is a low-priority cosmetic improvement.

---

## Part 4: Clean Up Server Code (Optional, Larger Effort)

### Context
The backend uses plain JavaScript. Converting to TypeScript would provide:
- Type safety for API requests/responses
- Better IDE support and refactoring
- Consistency with the frontend

### Assessment
This is a significant effort that would require:
- Adding `typescript`, `ts-node`, and `@types/*` packages to server
- Creating `tsconfig.json` for the server
- Converting all `.js` files to `.ts`
- Adding type definitions for Express routes, IPP responses, etc.

**Recommendation**: Skip for now unless there's a specific need. The server code is stable and well-documented with JSDoc comments that provide type hints.

---

## Summary of Changes

| Priority | Change | Impact |
|----------|--------|--------|
| High | Delete `src/App.css` (unused) | Removes 42 lines of dead code |
| Medium | Remove deprecated PDF functions | Cleaner API, removes confusion |
| Low | Clean up AddressInput toggle styling | Cosmetic consistency |
| Deferred | TypeScript migration for server | Significant effort, stable as-is |

---

## Files to Modify

| File | Action |
|------|--------|
| `src/App.css` | Delete entire file |
| `src/App.tsx` | Remove `import './App.css'` if present |
| `server/lib/pdf-cropper.js` | Remove `cropPdfWhitespace` and `smartCropPdf` functions |
| `server/routes/api.js` | Update import and replace `cropPdfWhitespace` with `cropPdfWithPadding` |

---

## Verification

1. After removing `App.css`: Verify the UI still renders correctly (it should, since the CSS isn't used)
2. After removing deprecated functions: Verify PDF download still works by testing the `/labels/:id/pdf?print=1` endpoint
