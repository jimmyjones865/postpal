
# Fix: Safari Clipboard Copy Not Working

## Problem Analysis

Safari on macOS has stricter requirements for the Clipboard API than Chrome or Firefox:

1. **User Activation Requirement**: Safari requires clipboard writes to happen immediately during a user gesture (click). Any async delays may cause the gesture to "expire"
2. **Silent Failures**: `navigator.clipboard.writeText()` can fail silently or throw a `NotAllowedError` in Safari
3. **No Error Visibility**: The current code catches errors but doesn't show them to the user, so failures appear as "nothing happening"

The current implementation uses `navigator.clipboard.writeText()` which should work, but Safari can be finicky. The solution is to add a fallback mechanism.

## Solution

Create a robust clipboard utility that:
1. Tries `navigator.clipboard.writeText()` first (modern API)
2. Falls back to `document.execCommand('copy')` if that fails (legacy but more reliable)
3. Shows a toast message on both success and failure

### New Utility Function

Create `src/lib/clipboard.ts`:

```typescript
/**
 * Copy text to clipboard with Safari fallback.
 * Uses modern Clipboard API with fallback to execCommand for Safari compatibility.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
      // Fall through to legacy method
    }
  }
  
  // Fallback: Create a temporary textarea and use execCommand
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Prevent scrolling to bottom on iOS
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    textArea.style.opacity = '0';
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    
    return success;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
}
```

### Update LabelHistory.tsx

Replace the `handleCopyId` function:

```typescript
import { copyToClipboard } from '@/lib/clipboard';

const handleCopyId = async (id: string, labelId: string) => {
  const success = await copyToClipboard(id);
  if (success) {
    setCopiedId(labelId);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedId(null), 300);
  } else {
    toast.error('Failed to copy to clipboard');
  }
};
```

### Update LabelResult.tsx

Replace the `handleCopyId` function:

```typescript
import { copyToClipboard } from '@/lib/clipboard';

const handleCopyId = async () => {
  if (!displayId) return;
  const success = await copyToClipboard(displayId);
  if (success) {
    setCopied(true);
    setTimeout(() => setCopied(false), 300);
  } else {
    toast.error('Failed to copy to clipboard');
  }
};
```

Also add the toast import to LabelResult.tsx since it doesn't currently have one:
```typescript
import { toast } from 'sonner';
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/clipboard.ts` | New file - Safari-compatible clipboard utility |
| `src/components/LabelHistory.tsx` | Use new `copyToClipboard` utility |
| `src/components/LabelResult.tsx` | Use new `copyToClipboard` utility, add toast import |

## Summary

- Create a new utility with fallback for Safari compatibility
- Show error toast if copy fails (instead of silent failure)
- Both components will use the same robust clipboard function
