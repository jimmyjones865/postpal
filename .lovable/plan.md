

# Plan: Codebase Compartmentalization & File Writing Safety

## Overview

This plan addresses two goals:
1. **Compartmentalization** - Split monolithic files into focused modules
2. **File Writing Safety** - Ensure atomic writes and proper error handling for metadata

---

## Part 1: File Writing Safety Improvements

### Current Issues

The current file writing logic in `server/routes/api.js` has potential race conditions and data loss risks:

**Problem 1: Non-atomic metadata writes**
```javascript
async function saveMetadata(metadata) {
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
}
```
If the process crashes mid-write, the JSON file could be corrupted (partial write).

**Problem 2: Spin-lock for concurrency**
```javascript
let metadataWriteInProgress = false;
async function withMetadataLock(fn) {
  while (metadataWriteInProgress) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  metadataWriteInProgress = true;
  // ...
}
```
This spin-lock isn't used consistently and only works within a single process.

**Problem 3: Lock not used everywhere**
The `withMetadataLock()` function exists but isn't actually called in label save/delete operations.

### Solution: Atomic Writes with Temp Files

**File: `server/lib/label-storage.js`** (new)

Create a dedicated storage module with safe file operations:

```javascript
import fs from 'fs/promises';
import path from 'path';

const METADATA_FILENAME = 'labels.json';

export function createLabelStorage(storagePath) {
  const metadataFile = path.join(storagePath, METADATA_FILENAME);
  let writeQueue = Promise.resolve();

  // Atomic write: write to temp file, then rename
  async function atomicWriteJson(filepath, data) {
    const tempPath = filepath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
    await fs.rename(tempPath, filepath);
  }

  async function ensureDir() {
    await fs.mkdir(storagePath, { recursive: true });
  }

  async function loadMetadata() {
    try {
      const data = await fs.readFile(metadataFile, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') return { labels: [] };
      
      // Try to recover from temp file if main file is corrupted
      try {
        const tempData = await fs.readFile(metadataFile + '.tmp', 'utf-8');
        console.warn('[Storage] Recovered metadata from temp file');
        const metadata = JSON.parse(tempData);
        await atomicWriteJson(metadataFile, metadata);
        return metadata;
      } catch {
        console.error('[Storage] Failed to read metadata:', err);
        throw err;
      }
    }
  }

  // Queue writes to prevent race conditions
  async function saveMetadata(metadata) {
    writeQueue = writeQueue.then(() => atomicWriteJson(metadataFile, metadata));
    return writeQueue;
  }

  async function saveLabel(pdfBase64, info) {
    await ensureDir();
    
    const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${id}.pdf`;
    const filepath = path.join(storagePath, filename);
    
    // Write PDF first (can fail without corrupting metadata)
    await fs.writeFile(filepath, Buffer.from(pdfBase64, 'base64'));
    
    // Then update metadata atomically
    const metadata = await loadMetadata();
    const labelInfo = { 
      id, 
      filename, 
      ...info, 
      createdAt: new Date().toISOString() 
    };
    metadata.labels.unshift(labelInfo);
    await saveMetadata(metadata);
    
    return labelInfo;
  }

  async function deleteLabel(id) {
    const metadata = await loadMetadata();
    const idx = metadata.labels.findIndex(l => l.id === id);
    if (idx === -1) return false;
    
    const filename = metadata.labels[idx].filename;
    
    // Update metadata first (most important)
    metadata.labels.splice(idx, 1);
    await saveMetadata(metadata);
    
    // Then try to delete file (non-critical if fails)
    try {
      await fs.unlink(path.join(storagePath, filename));
    } catch (err) {
      console.warn(`[Storage] Could not delete file ${filename}:`, err.message);
    }
    
    return true;
  }

  async function getLabel(id) {
    const metadata = await loadMetadata();
    return metadata.labels.find(l => l.id === id) || null;
  }

  async function getAllLabels() {
    const metadata = await loadMetadata();
    return metadata.labels;
  }

  async function getLabelPdf(id) {
    const label = await getLabel(id);
    if (!label) return null;
    return fs.readFile(path.join(storagePath, label.filename));
  }

  async function cleanupOldLabels(retentionDays) {
    const metadata = await loadMetadata();
    const maxAge = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    const toKeep = [];
    const toDelete = [];
    
    for (const label of metadata.labels) {
      const age = now - new Date(label.createdAt).getTime();
      if (age > maxAge) toDelete.push(label);
      else toKeep.push(label);
    }
    
    // Update metadata first
    metadata.labels = toKeep;
    await saveMetadata(metadata);
    
    // Then delete files
    for (const label of toDelete) {
      try {
        await fs.unlink(path.join(storagePath, label.filename));
        console.log(`[Cleanup] Deleted: ${label.filename}`);
      } catch (err) {
        console.warn(`[Cleanup] Could not delete ${label.filename}:`, err.message);
      }
    }
    
    return { deleted: toDelete.length, kept: toKeep.length };
  }

  return {
    ensureDir,
    loadMetadata,
    saveLabel,
    deleteLabel,
    getLabel,
    getAllLabels,
    getLabelPdf,
    cleanupOldLabels
  };
}
```

### Key Safety Improvements

| Issue | Solution |
|-------|----------|
| Partial write corruption | Write to `.tmp` file, then atomic `rename()` |
| Race conditions | Queue writes sequentially |
| Orphaned temp files | Check for `.tmp` file on load, recover if valid |
| Delete order | Update metadata before deleting file (metadata is source of truth) |

---

## Part 2: Backend Route Modularization

Split `server/routes/api.js` (568 lines) into focused modules.

### New File Structure

```
server/
├── lib/
│   ├── cups-printer.js      # existing
│   ├── pdf-cropper.js       # existing
│   ├── european-address-parser.js  # existing
│   ├── label-storage.js     # new - file storage with atomic writes
│   └── dhl-api.js           # new - Deutsche Post API client
├── routes/
│   ├── api.js               # simplified - mounts sub-routers
│   ├── labels.js            # new - label CRUD & purchase
│   ├── print.js             # new - CUPS printing
│   └── wallet.js            # new - wallet balance
└── index.js
```

### New Files

**`server/lib/dhl-api.js`**

Extract Deutsche Post API logic:

```javascript
export function createDhlClient(config = {}) {
  const DHL_API_BASE = config.apiBase || 'https://api-eu.dhl.com/post/de/shipping/im/v1';
  
  let cachedToken = {
    accessToken: null,
    expiresAt: 0,
    walletBalance: null
  };

  async function authenticate(credentials) {
    // ... existing authenticateDHL logic
  }

  async function getAccessToken(credentials, forceRefresh = false) {
    // ... existing token caching logic
  }

  function getWalletBalance() {
    return cachedToken.walletBalance;
  }

  function buildAddressObject(addr) {
    // ... existing logic
  }

  async function purchaseLabel(tokenData, payload) {
    // ... purchase logic extracted from route
  }

  return {
    authenticate,
    getAccessToken,
    getWalletBalance,
    buildAddressObject,
    purchaseLabel
  };
}
```

**`server/routes/labels.js`**

Label-specific routes:

```javascript
import express from 'express';
import { cropPdfWithPadding } from '../lib/pdf-cropper.js';

export function createLabelsRouter(storage, dhlClient, paperFormats) {
  const router = express.Router();

  // POST /api/labels - save label
  router.post('/', async (req, res) => {
    // ... uses storage.saveLabel()
  });

  // GET /api/labels - list all
  router.get('/', async (req, res) => {
    // ... uses storage.getAllLabels()
  });

  // GET /api/labels/:id/pdf - download PDF
  router.get('/:id/pdf', async (req, res) => {
    // ... uses storage.getLabelPdf()
  });

  // DELETE /api/labels/:id
  router.delete('/:id', async (req, res) => {
    // ... uses storage.deleteLabel()
  });

  // POST /api/labels/purchase - buy from DHL
  router.post('/purchase', async (req, res) => {
    // ... uses dhlClient.purchaseLabel()
  });

  return router;
}
```

**`server/routes/print.js`**

Print-specific routes:

```javascript
import express from 'express';
import { cropPdfWithPadding, rotatePdf, getContentDimensions } from '../lib/pdf-cropper.js';
import { sendToCups } from '../lib/cups-printer.js';

export function createPrintRouter(storage) {
  const router = express.Router();

  // POST /api/print - send to CUPS
  router.post('/', async (req, res) => {
    // ... existing print logic
  });

  // POST /api/labels/:id/dimensions
  router.post('/labels/:id/dimensions', async (req, res) => {
    // ... existing dimensions logic
  });

  return router;
}
```

**`server/routes/wallet.js`**

Wallet routes:

```javascript
import express from 'express';

export function createWalletRouter(dhlClient, getCredentials) {
  const router = express.Router();

  router.post('/balance', async (req, res) => {
    // ... existing balance logic
  });

  return router;
}
```

**Updated `server/routes/api.js`**

Becomes a thin orchestrator:

```javascript
import express from 'express';
import { createLabelStorage } from '../lib/label-storage.js';
import { createDhlClient } from '../lib/dhl-api.js';
import { createLabelsRouter } from './labels.js';
import { createPrintRouter } from './print.js';
import { createWalletRouter } from './wallet.js';
import { parseAddress } from '../lib/european-address-parser.js';

export function createApiRouter() {
  const router = express.Router();
  
  // Configuration
  const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || '/data/labels';
  const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60', 10);
  
  // Initialize shared services
  const storage = createLabelStorage(PDF_STORAGE_PATH);
  const dhlClient = createDhlClient();
  const paperFormats = loadPaperFormats();
  
  function getCredentials() {
    return {
      apiKey: process.env.DHL_API_KEY,
      apiSecret: process.env.DHL_API_SECRET,
      portokasseLogin: process.env.DHL_PORTOKASSE_LOGIN,
      portokassePassword: process.env.DHL_PORTOKASSE_PASSWORD
    };
  }
  
  // Mount sub-routers
  router.use('/labels', createLabelsRouter(storage, dhlClient, paperFormats, getCredentials));
  router.use('/', createPrintRouter(storage));
  router.use('/wallet', createWalletRouter(dhlClient, getCredentials));
  
  // Simple routes stay here
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', storagePath: PDF_STORAGE_PATH, retentionDays: RETENTION_DAYS });
  });
  
  router.get('/credentials/status', (req, res) => {
    const creds = getCredentials();
    res.json({ configured: Boolean(creds.apiKey && creds.apiSecret && creds.portokasseLogin && creds.portokassePassword) });
  });
  
  router.post('/parse-address', (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'Missing address' });
    res.json(parseAddress(address));
  });
  
  router.get('/proxy-pdf', async (req, res) => {
    // ... existing proxy logic
  });
  
  // Initialize and schedule cleanup
  storage.ensureDir().then(() => {
    storage.cleanupOldLabels(RETENTION_DAYS);
    setInterval(() => storage.cleanupOldLabels(RETENTION_DAYS), 24 * 60 * 60 * 1000);
  });
  
  return router;
}
```

---

## Part 3: Frontend Service Layer

Extract API calls from `Index.tsx` into services.

**`src/services/labelService.ts`** (new)

```typescript
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface PurchaseResult {
  success: boolean;
  pdfUrl?: string;
  trackingNumber?: string;
  voucherId?: string;
  newBalance?: number;
  error?: string;
  details?: string;
}

export async function purchaseLabel(params: {
  sender: object;
  receiver: object;
  productCode: string;
  priceInCents: number;
  paperFormatName: string;
}): Promise<PurchaseResult> {
  const response = await fetch(`${API_BASE}/labels/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.success) {
    return { 
      success: false, 
      error: data.error || 'Purchase failed',
      details: data.details 
    };
  }
  
  return {
    success: true,
    pdfUrl: data.pdfUrl,
    trackingNumber: data.trackingNumber,
    voucherId: data.voucherId,
    newBalance: data.newBalance
  };
}

export async function fetchPdfAsBase64(pdfUrl: string): Promise<string> {
  const proxyUrl = `${API_BASE}/proxy-pdf?url=${encodeURIComponent(pdfUrl)}`;
  const response = await fetch(proxyUrl);
  
  if (!response.ok) {
    throw new Error(`PDF fetch failed: ${response.status}`);
  }
  
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function printLabel(labelId: string, config: DirectPrintConfig): Promise<void> {
  const response = await fetch(`${API_BASE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      labelId,
      cupsUrl: config.cupsUrl,
      printerName: config.printerName,
      orientation: config.orientation,
      cropH: config.cropMarginHorizontal,
      cropV: config.cropMarginVertical,
      disableCropping: config.disableCropping,
      paperWidthMm: config.paperWidthMm,
      paperHeightMm: config.paperHeightMm,
      endlessRoll: config.endlessRoll
    })
  });
  
  const result = await response.json();
  
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Print failed');
  }
}

export async function downloadLabel(labelId: string, cropH: number, cropV: number): Promise<void> {
  const pdfUrl = `${API_BASE}/labels/${labelId}/pdf?print=1&cropH=${cropH}&cropV=${cropV}`;
  const response = await fetch(pdfUrl);
  
  if (!response.ok) {
    throw new Error('Download failed');
  }
  
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `label-${labelId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

**`src/lib/printConfig.ts`** (new)

Shared type and builder:

```typescript
import { PrinterConfig } from '@/types/shipping';

export interface DirectPrintConfig {
  cupsUrl: string;
  printerName: string;
  orientation: 'portrait' | 'landscape';
  cropMarginHorizontal: number;
  cropMarginVertical: number;
  disableCropping: boolean;
  paperWidthMm: number;
  paperHeightMm: number;
  endlessRoll: boolean;
}

export function buildDirectPrintConfig(config: PrinterConfig): DirectPrintConfig {
  return {
    cupsUrl: config.cupsUrl || '',
    printerName: config.printerName || '',
    orientation: config.orientation,
    cropMarginHorizontal: config.cropMarginHorizontal ?? 5,
    cropMarginVertical: config.cropMarginVertical ?? 5,
    disableCropping: config.disableCropping || false,
    paperWidthMm: config.paperWidthMm ?? 62,
    paperHeightMm: config.paperHeightMm ?? 100,
    endlessRoll: config.endlessRoll ?? true
  };
}
```

---

## Summary of All Changes

| File | Action | Purpose |
|------|--------|---------|
| `server/lib/label-storage.js` | Create | Atomic file writes, write queue, recovery |
| `server/lib/dhl-api.js` | Create | DHL auth, token cache, API calls |
| `server/routes/labels.js` | Create | Label CRUD + purchase routes |
| `server/routes/print.js` | Create | CUPS printing routes |
| `server/routes/wallet.js` | Create | Wallet balance route |
| `server/routes/api.js` | Refactor | Thin orchestrator (~80 lines vs 568) |
| `src/services/labelService.ts` | Create | Frontend API abstraction |
| `src/lib/printConfig.ts` | Create | Shared print config type/builder |
| `src/pages/Index.tsx` | Refactor | Use service layer (~100 lines shorter) |
| `src/components/LabelHistory.tsx` | Refactor | Use shared print config type |

---

## File Writing Safety Summary

| Before | After |
|--------|-------|
| Direct `writeFile()` can corrupt on crash | Atomic write via temp file + rename |
| Spin-lock unused | Sequential write queue |
| No recovery mechanism | Auto-recover from `.tmp` file |
| Delete file before metadata | Delete metadata first (source of truth) |
| Inline storage logic | Dedicated `label-storage.js` module |

---

## Implementation Order

1. **Create `server/lib/label-storage.js`** - Safe storage module
2. **Create `server/lib/dhl-api.js`** - DHL client extraction
3. **Create route modules** - `labels.js`, `print.js`, `wallet.js`
4. **Refactor `server/routes/api.js`** - Thin orchestrator
5. **Create `src/services/labelService.ts`** - Frontend service
6. **Create `src/lib/printConfig.ts`** - Shared types
7. **Update `Index.tsx` and `LabelHistory.tsx`** - Use services

---

## Verification

1. **Atomic writes**: Kill server during save, verify no corruption on restart
2. **Recovery**: Manually corrupt `labels.json`, verify recovery from `.tmp`
3. **API unchanged**: All routes maintain same request/response format
4. **Print flow**: Test both direct CUPS print and PDF download
5. **Label history**: Verify save/list/delete/print-again all work

