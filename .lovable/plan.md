
# Codebase Cleanup Plan

## Overview

This plan fixes build errors and cleans up legacy code after your migration to Julia Mono fonts and the custom European address parser.

---

## 1. Files to Delete (4 files)

| File | Reason |
|------|--------|
| `src/pages/_app.tsx` | Next.js file - incompatible with Vite |
| `src/pages/_document.tsx` | Next.js file - font preloading already in `index.css` |
| `src/components/NavLink.tsx` | Unused component |
| `src/hooks/useLibpostal.ts` | Legacy libpostal hook - replaced by server-side parser |

---

## 2. Files to Rename (1 file)

| Current | New Name | Reason |
|---------|----------|--------|
| `src/lib/addressParser.ts` | `src/lib/address.ts` | Remove "parser" reference since parsing is now server-side; this file only contains types and formatting utilities |

---

## 3. Files to Modify

### 3.1 `src/hooks/useConfig.ts`
**Issue**: Missing `paperFormatName` in default config

Add `paperFormatName: ''` to the `printerConfig` defaults (line 15):
```typescript
printerConfig: {
  paperFormat: 'a6',
  printerName: '',
  paperFormatName: '',  // Add this line
  orientation: 'portrait',
  cropMarginHorizontal: 5,
  cropMarginVertical: 5,
},
```

### 3.2 `src/pages/Index.tsx`
**Issues**: 
- Unused `updateApiCredentials` import
- Invalid `credentials` prop on WalletBalance

Changes:
1. Line 27: Remove `updateApiCredentials` from destructure
2. Line 17: Update import path from `@/lib/addressParser` to `@/lib/address`
3. Line 273: Remove `credentials={config.apiCredentials}` prop

### 3.3 `src/components/ParsedAddressEditor.tsx`
**Issues**: 
- Uses legacy `useLibpostal` hook
- References removed libpostal availability check

Changes:
1. Remove `useLibpostal` import (line 5)
2. Update import path from `@/lib/addressParser` to `@/lib/address` (line 4)
3. Create new `useAddressParser` hook inline or as separate file that calls `/api/parse-address` without libpostal-specific logic
4. Remove `isAvailable` state and the "libpostal unavailable" warning block (lines 67-73)
5. Update console.log message from "Libpostal parse result" to "Parse result" (line 30)

### 3.4 `src/lib/address.ts` (renamed from addressParser.ts)
**Issue**: Comment references libpostal

Update the comment on line 2:
```typescript
// Address types and formatting utilities
// Parsing is done server-side via european-address-parser
```

---

## 4. New Hook: `src/hooks/useAddressParser.ts`

Create a clean replacement for `useLibpostal` without the libpostal-specific logic:

```typescript
import { useState, useCallback } from 'react';
import { ParsedAddress } from '@/lib/address';

interface UseAddressParserResult {
  parseAddress: (address: string) => Promise<ParsedAddress | null>;
  isLoading: boolean;
  error: string | null;
}

export function useAddressParser(): UseAddressParserResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseAddress = useCallback(async (address: string): Promise<ParsedAddress | null> => {
    if (!address.trim()) return null;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api';
      const response = await fetch(`${apiUrl}/parse-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to parse address');
      }
      
      return await response.json() as ParsedAddress;
    } catch (err) {
      console.warn('Address parsing failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { parseAddress, isLoading, error };
}
```

---

## Summary of Changes

| Action | Count | Details |
|--------|-------|---------|
| Delete files | 4 | Next.js files, NavLink, useLibpostal |
| Rename files | 1 | addressParser.ts -> address.ts |
| Modify files | 4 | useConfig, Index, ParsedAddressEditor, address.ts |
| Create files | 1 | useAddressParser.ts |

---

## Technical Details

### Build Errors Fixed
1. `TS2741` - Missing `paperFormatName` property in useConfig defaults
2. `TS2322` - Invalid `credentials` prop on WalletBalance component  
3. `TS2307` - Cannot find module 'next/app' (file deleted)
4. `TS2307` - Cannot find module 'next/document' (file deleted)

### Import Updates Required
After renaming `addressParser.ts` to `address.ts`, update imports in:
- `src/pages/Index.tsx`
- `src/components/ParsedAddressEditor.tsx`
- `src/hooks/useAddressParser.ts` (new file)
