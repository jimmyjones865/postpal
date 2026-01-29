
# Cleanup: Remove Unused Function from countryCodes.ts

## What's Being Removed

The `extractCountryFromAddress` function (lines 319-328) is exported but never used anywhere in the codebase. It was likely created as a utility that ended up not being needed.

## File to Modify

`src/lib/countryCodes.ts`

## Change

Remove lines 319-328:

```typescript
// DELETE THIS:
export function extractCountryFromAddress(address: string): { country: string | null; isoCode: string | null } {
  const lines = address.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { country: null, isoCode: null };
  
  // Last non-empty line is typically the country
  const lastLine = lines[lines.length - 1];
  const isoCode = getCountryCode(lastLine);
  
  return { country: lastLine, isoCode };
}
```

## What Remains

- `COUNTRY_CODES` constant (the translation table) - actively used
- `getCountryCode()` function - actively used in Index.tsx

This is a small, safe cleanup with zero risk of breaking anything.
