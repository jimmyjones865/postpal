

# Complete Plan: LabelResult with ID Display, Actions, and Custom Filenames

## Overview

Replace the mock label preview with a functional LabelResult component that shows:
1. Read-only parsed recipient address (fills after parsing)
2. Purchased label PDF embed (fills after purchase, landscape orientation)
3. Download and Print buttons (enabled after purchase)
4. Voucher/Track ID with click-to-copy and flash animation

All sections clear when address input changes. The ID is stored with label history and used in the PDF filename.

---

## UI Layout

```text
+---------------------------+
| Parsed Recipient          |
| (read-only, after parse)  |
+---------------------------+
| Purchased Label PDF       |
| (landscape, sized by      |
|  paper format)            |
+---------------------------+
| [ Download ]  [ Print ]   |
| (disabled until purchase) |
+---------------------------+
| ID: ABC123456...    [📋]  |
| (click to copy, flash)    |
+---------------------------+
```

---

## Implementation Details

### 1. Update Types and Storage Interface

**File: `src/lib/labelStorage.ts`**

Add `voucherId` and `trackId` to `StoredLabel` interface:

```typescript
export interface StoredLabel {
  id: string;
  filename: string;
  recipientAddress: string;
  productCode: string;
  productName: string;
  voucherId?: string;   // Always returned by DHL
  trackId?: string;     // Only for tracked products
  createdAt: string;
}
```

Update `saveLabel` function signature to accept these fields.

---

### 2. Create LabelResult Component

**File: `src/components/LabelResult.tsx`** (new file)

Props:
```typescript
interface LabelResultProps {
  parsedRecipient: ParsedAddress;
  purchasedLabelId: string | null;
  voucherId: string | null;
  trackId: string | null;
  paperFormat: { widthMm: number; heightMm: number } | null;
  printOptions: PrintOptions;
  directPrintConfig: DirectPrintConfig;
}
```

Four sections:
1. **Parsed Address**: Read-only `<pre>` showing formatted recipient using `formatParsedAddress()`
2. **PDF Embed**: `<iframe>` showing purchased label, sized by paper format with longer axis horizontal
3. **Action Buttons**: Download and Print, both disabled until `purchasedLabelId` is set
4. **ID Field**: Shows `trackId` or `voucherId`, click triggers clipboard copy with flash animation

PDF sizing logic:
```typescript
const computePreviewStyle = (format: { widthMm: number; heightMm: number } | null) => {
  if (!format) return { height: '120px' };
  
  // Display with longer axis horizontal
  const isLandscape = format.widthMm >= format.heightMm;
  const aspectRatio = isLandscape 
    ? format.widthMm / format.heightMm 
    : format.heightMm / format.widthMm;
  
  // Fixed width container, calculate height from aspect ratio
  return { aspectRatio: String(aspectRatio) };
};
```

---

### 3. Update Index Page State Management

**File: `src/pages/Index.tsx`**

Add new state:
```typescript
const [purchasedLabelId, setPurchasedLabelId] = useState<string | null>(null);
const [voucherId, setVoucherId] = useState<string | null>(null);
const [trackId, setTrackId] = useState<string | null>(null);
```

Add paper format lookup (fetch from `/paper-formats.json`):
```typescript
const [paperFormats, setPaperFormats] = useState<PaperFormat[]>([]);

useEffect(() => {
  fetch('/paper-formats.json')
    .then(res => res.json())
    .then(data => setPaperFormats(data.formats || []));
}, []);

const selectedFormat = paperFormats.find(f => f.name === config.printerConfig.paperFormatName);
const previewDimensions = selectedFormat ? {
  widthMm: selectedFormat.pageLayout.size.x,
  heightMm: selectedFormat.pageLayout.size.y
} : null;
```

Add effect to clear results on address change:
```typescript
useEffect(() => {
  // Clear purchase results when address changes
  setPurchasedLabelId(null);
  setVoucherId(null);
  setTrackId(null);
}, [recipientAddress]);
```

Update `handlePrint`:
- Capture `voucherId` and `trackId` from `purchaseData` (already returned by API)
- Pass both to `saveLabel()`
- Set `purchasedLabelId`, `voucherId`, `trackId` after successful save
- Remove form reset (let user see result, cleared on address change)

Replace `LabelPreview` and `TrackingNumber` with `LabelResult` component.

---

### 4. Update Backend Storage

**File: `server/routes/labels.js`**

Update POST `/labels` to accept and store `voucherId` and `trackId`:

```javascript
const { pdfBase64, recipientAddress, productCode, productName, voucherId, trackId } = req.body;

const labelInfo = await storage.saveLabel(pdfBase64, {
  recipientAddress,
  productCode,
  productName,
  voucherId: voucherId || null,
  trackId: trackId || null
});
```

---

### 5. Custom PDF Filename Generation

**File: `server/lib/label-storage.js`**

Update `saveLabel` to generate descriptive filenames:

Format: `YYYYMMDD_hhmmss_firstname-lastname_id.pdf`

```javascript
async function saveLabel(pdfBase64, info) {
  await ensureDir();
  
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const namePart = extractRecipientName(info.recipientAddress);
  const idPart = info.trackId || info.voucherId || 'noid';
  
  const filename = `${timestamp}_${namePart}_${idPart}.pdf`;
  const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // ... rest of save logic
}

function formatTimestamp(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
         `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function extractRecipientName(address) {
  const firstLine = (address || '').split('\n')[0] || '';
  const words = firstLine.trim().split(/\s+/).slice(0, 2);
  return words
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean)
    .join('-') || 'unknown';
}
```

Example filenames:
- `20250125_143052_max-mustermann_RG123456789DE.pdf`
- `20250125_150230_anna-schmidt_A0001234567.pdf`

---

### 6. Update Label History Display

**File: `src/components/LabelHistory.tsx`**

Add ID display with copy functionality in each history item:

```tsx
const handleCopyId = async (id: string) => {
  await navigator.clipboard.writeText(id);
  toast.success('Copied to clipboard');
};

// In the label item:
{(label.trackId || label.voucherId) && (
  <button 
    onClick={() => handleCopyId(label.trackId || label.voucherId!)}
    className="font-mono text-xs truncate hover:bg-muted px-1 rounded flex items-center gap-1"
    title="Click to copy"
  >
    <span className="truncate max-w-[120px]">
      {label.trackId || label.voucherId}
    </span>
    <Copy className="w-3 h-3 flex-shrink-0" />
  </button>
)}
```

---

### 7. Add Flash Animation CSS

**File: `src/index.css`**

```css
@keyframes flash-copy {
  0%, 100% { background-color: transparent; }
  50% { background-color: hsl(var(--primary) / 0.3); }
}

.animate-flash {
  animation: flash-copy 0.3s ease;
}
```

---

### 8. Delete Obsolete Components

- **Delete:** `src/components/LabelPreview.tsx`
- **Delete:** `src/components/TrackingNumber.tsx`

---

## Files Summary

| File | Action |
|------|--------|
| `src/lib/labelStorage.ts` | Add voucherId/trackId to interface and saveLabel |
| `src/components/LabelResult.tsx` | **New** - address, PDF, buttons, ID |
| `src/components/LabelPreview.tsx` | **Delete** |
| `src/components/TrackingNumber.tsx` | **Delete** |
| `src/pages/Index.tsx` | Add state, effects, use LabelResult |
| `src/components/LabelHistory.tsx` | Add ID display with copy |
| `src/index.css` | Add flash animation |
| `server/routes/labels.js` | Accept voucherId/trackId |
| `server/lib/label-storage.js` | Custom filename generation |

---

## State Flow

```text
1. User pastes address
   → parsedRecipient populated
   → LabelResult shows formatted address
   → PDF embed empty, buttons disabled, ID empty

2. User triggers purchase
   → API returns pdfUrl, voucherId, trackId
   → Label saved with custom filename including ID
   → purchasedLabelId, voucherId, trackId set
   → LabelResult shows PDF embed, enables buttons, shows ID

3. User clicks Download
   → downloadLabel() with crop settings
   → Browser downloads cropped PDF

4. User clicks Print
   → Uses CUPS if enabled, else browser print
   → Same settings as history/address pane

5. User clicks ID field
   → Copy to clipboard
   → Field flashes

6. User changes address input
   → All purchase results clear (PDF, buttons, ID)
   → Parsed address updates immediately
```

---

## Edge Cases

- **No trackId**: Display voucherId (always present from DHL)
- **No paper format selected**: Use default aspect ratio
- **Address cleared**: All result fields clear
- **Copy failure**: Silently fail (clipboard API may be denied)
- **PDF sizing**: Longer axis horizontal, scaled to fit container width
- **Filename special chars**: Stripped from recipient name (only a-z, 0-9 kept)

