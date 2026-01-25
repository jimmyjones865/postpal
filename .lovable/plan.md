
# Implementation Plan: Configurable Debug Levels

## Overview

Add a centralized logging utility with four configurable levels (`debug`, `info`, `warn`, `none`) controlled via `LOG_LEVEL` environment variable in docker-compose.yml.

## Log Level Hierarchy

| Level | Shows | Use Case |
|-------|-------|----------|
| `debug` | All logs (debug + info + warn + error) | Development/troubleshooting |
| `info` | info + warn + error | Normal production (default) |
| `warn` | warn + error only | Quiet mode, alerts only |
| `none` | error only | Silent except critical failures |

Note: `error` logs are always shown regardless of level.

## Implementation Steps

### 1. Create Logger Utility

**New file: `server/lib/logger.js`**

```javascript
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, none: 3 };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

export const logger = {
  debug: (...args) => currentLevel <= LOG_LEVELS.debug && console.log(...args),
  info:  (...args) => currentLevel <= LOG_LEVELS.info  && console.log(...args),
  warn:  (...args) => currentLevel <= LOG_LEVELS.warn  && console.warn(...args),
  error: (...args) => console.error(...args)  // Always shown
};
```

### 2. Update docker-compose.yml

Add `LOG_LEVEL` environment variable:

```yaml
environment:
  # Server configuration
  - PORT=3000
  - LOG_LEVEL=info        # debug | info | warn | none
  - PDF_STORAGE_PATH=/data/labels
  # ... rest unchanged
```

### 3. Replace console.* Calls

Update all server files to import and use the logger:

| File | Changes |
|------|---------|
| `server/index.js` | Startup messages → `logger.info` |
| `server/routes/api.js` | Paper formats error → `logger.error`; Address parsing I/O → `logger.debug` |
| `server/routes/labels.js` | Purchase errors → `logger.error` |
| `server/routes/print.js` | Crop results → `logger.info`; Crop failures → `logger.error` |
| `server/routes/wallet.js` | Balance errors → `logger.error` |
| `server/lib/dhl-api.js` | Auth/purchase payloads → `logger.debug`; Token received → `logger.info` |
| `server/lib/label-storage.js` | Save/delete confirmations → `logger.info`; Recovery warnings → `logger.warn`; Read failures → `logger.error` |
| `server/lib/cups-printer.js` | Print job info → `logger.info`; Print errors → `logger.error` |
| `server/lib/pdf-cropper.js` | All dimension/pixel logs → `logger.debug`; Fallback warnings → `logger.warn` |

### 4. Log Level Mapping

**DEBUG** (verbose internals):
- `[DHL] Body params (masked):...`
- `[DHL] Purchasing label:...` (full JSON)
- `[DHL] Purchase response status=...`
- `[ParseAddress] Input:...` / `Parsed:...`
- `[PDFCropper] Page X: viewport...`
- `[PDFCropper] Page X: found N ink pixels`
- `[PDFCropper] Page X: detected content at...`

**INFO** (normal operations):
- `Server running on port...`
- `[DHL] Authenticating...`
- `[DHL] Token received, balance:...`
- `[Storage] Saved label:...`
- `[Storage] Deleted label file:...`
- `[CUPS] Sending print job to:...`
- `[Print] PDF cropped to...`
- `[Cleanup] Running...` / `Complete...`

**WARN** (recoverable issues):
- `[Storage] Recovered metadata from temp file`
- `[Storage] Could not delete file...`
- `[PDFCropper] No content detected...`
- `[PDFCropper] Suspiciously small content bounds...`
- `[Cleanup] Could not delete...`

**ERROR** (critical failures - always shown):
- `Failed to load paper formats JSON:...`
- `[Storage] Failed to read metadata:...`
- `[CUPS] Print error:...`
- `[Labels] Purchase error:...`
- `[Print] Crop failed:...`

## Files Summary

| File | Action |
|------|--------|
| `server/lib/logger.js` | **New** - centralized logger utility |
| `docker-compose.yml` | Add LOG_LEVEL env var |
| `server/index.js` | Use logger.info for startup |
| `server/routes/api.js` | Replace console calls |
| `server/routes/labels.js` | Replace console calls |
| `server/routes/print.js` | Replace console calls |
| `server/routes/wallet.js` | Replace console calls |
| `server/lib/dhl-api.js` | Replace console calls |
| `server/lib/label-storage.js` | Replace console calls |
| `server/lib/cups-printer.js` | Replace console calls |
| `server/lib/pdf-cropper.js` | Replace console calls |

## Usage Examples

```bash
# Verbose debugging
LOG_LEVEL=debug docker compose up

# Normal production (default)
LOG_LEVEL=info docker compose up

# Quiet mode - only warnings and errors
LOG_LEVEL=warn docker compose up

# Silent - only critical errors
LOG_LEVEL=none docker compose up
```
