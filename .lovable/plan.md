
# Fix: History Tab ID Copy and Add Tracking Link

## Issues Identified

1. **ID Copy Not Working**: The button in LabelHistory is missing `type="button"` attribute (same issue that was fixed in LabelResult)
2. **Missing Tracking Link**: Need to add a clickable link to Deutsche Post tracking page when a trackId is present

## Changes Required

### File: `src/components/LabelHistory.tsx`

#### 1. Add Missing Import
Add `ExternalLink` icon from lucide-react for the tracking link.

#### 2. Add Flash Animation State
Add state to track which label ID was just copied (for flash animation).

#### 3. Fix Copy Button
- Add `type="button"` to prevent form interference
- Add flash animation like LabelResult
- Use `cn()` utility for conditional classes

#### 4. Add Tracking Link
Add an external link icon next to trackId that opens:
`https://www.deutschepost.de/en/s/shipment-tracking.html?piececode={trackId}`

### Updated Code Structure (lines 140-151)

```tsx
{(label.trackId || label.voucherId) && (
  <div className="flex items-center gap-1">
    <button 
      type="button"  // Fix: explicit type
      onClick={() => handleCopyId(label.trackId || label.voucherId!, label.id)}
      className={cn(
        "font-mono truncate hover:bg-muted px-1 rounded flex items-center gap-1 max-w-[100px]",
        copiedId === label.id && "animate-flash"
      )}
      title="Click to copy ID"
    >
      <span className="truncate">
        {label.trackId || label.voucherId}
      </span>
      <Copy className="w-3 h-3 flex-shrink-0" />
    </button>
    
    {/* Tracking link - only show for trackId */}
    {label.trackId && (
      <a
        href={`https://www.deutschepost.de/en/s/shipment-tracking.html?piececode=${label.trackId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-primary"
        title="Track shipment"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    )}
  </div>
)}
```

### Updated handleCopyId Function

```tsx
const [copiedId, setCopiedId] = useState<string | null>(null);

const handleCopyId = async (id: string, labelId: string) => {
  try {
    await navigator.clipboard.writeText(id);
    setCopiedId(labelId);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedId(null), 300);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
};
```

## Summary of Changes

| Change | Description |
|--------|-------------|
| Add import | `ExternalLink` from lucide-react, `cn` from utils |
| Add state | `copiedId` to track flash animation per label |
| Fix button | Add `type="button"` attribute |
| Add animation | Apply `animate-flash` class on copy |
| Add tracking link | External link to Deutsche Post tracking (only for trackId) |
