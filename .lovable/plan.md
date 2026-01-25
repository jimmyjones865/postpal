
# Fix Plan: ID Copy Flash Animation and PDF Toolbar

## Issues Identified

1. **Copy Flash Animation Not Visible**: The `animate-flash` keyframes animate between `transparent` and a primary color, but the button already has `bg-muted/50` background. The transparent state doesn't show because the base background is already set.

2. **PDF Viewer Toolbar Showing**: The iframe loads the PDF with the browser's default PDF viewer controls (toolbar, page navigation, zoom). These can be hidden using PDF URL parameters.

---

## Fixes

### 1. Fix Flash Animation (src/index.css)

Update the keyframes to use the button's actual background color as the base:

```css
@keyframes flash-copy {
  0%, 100% { background-color: hsl(var(--muted) / 0.5); }
  50% { background-color: hsl(var(--primary) / 0.5); }
}
```

This ensures the flash is visible against the button's normal `bg-muted/50` state.

---

### 2. Hide PDF Viewer Toolbar (src/components/LabelResult.tsx)

Append PDF viewer parameters to disable the toolbar:

```typescript
const pdfUrl = purchasedLabelId 
  ? `${API_BASE}/labels/${purchasedLabelId}/pdf#toolbar=0&navpanes=0&scrollbar=0&view=Fit` 
  : null;
```

The parameters:
- `toolbar=0` - Hide the toolbar
- `navpanes=0` - Hide navigation panes  
- `scrollbar=0` - Hide scrollbar
- `view=Fit` - Fit the PDF to the container

---

## Files to Change

| File | Change |
|------|--------|
| `src/index.css` | Update flash-copy keyframes with proper background colors |
| `src/components/LabelResult.tsx` | Append PDF parameters to hide viewer toolbar |

---

## Summary

Two small changes:
1. Fix animation keyframes to flash between `muted` and `primary` colors
2. Add `#toolbar=0&navpanes=0&scrollbar=0&view=Fit` to PDF URL to hide browser PDF viewer controls
