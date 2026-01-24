
# Plan: Update Label Preview with Structured Address Fields

## Overview

Enhance the LabelPreview component to display structured address fields for both sender and recipient, matching the actual Deutsche Post label layout. The component will receive the parsed recipient address to properly display additionalName, addressLine2, and country.

## Changes Required

### 1. Update LabelPreview Props

**File**: `src/components/LabelPreview.tsx`

Change the props to accept the parsed recipient address instead of (or in addition to) the raw string:

| Current Prop | New Prop |
|-------------|----------|
| `recipientAddress: string` | `parsedRecipient: ParsedAddress` |

Import `ParsedAddress` from `@/lib/address`.

### 2. Update Sender Address Display

The sender's `company` field is actually `additionalName` - it should be displayed as-is (not forced to uppercase). Format the sender as a single condensed line:

```
additionalName (if present), Name, Street, ZIP City, Country (if not DE)
```

### 3. Update Recipient Address Display

Display recipient fields in this exact order:
1. `additionalName` (if present) - e.g., company name, c/o
2. `name` - recipient name
3. `street` - street address
4. `addressLine2` (if present) - apartment, floor, etc.
5. `zip city` - postal code and city
6. `country` - only if not "Deutschland" or "Germany"

### 4. Update Index.tsx to Pass Parsed Recipient

**File**: `src/pages/Index.tsx`

Change the LabelPreview usage from:
```tsx
<LabelPreview 
  senderAddress={config.senderAddress} 
  recipientAddress={recipientAddress}  // string
  selectedProduct={selectedProductData} 
/>
```

To:
```tsx
<LabelPreview 
  senderAddress={config.senderAddress} 
  parsedRecipient={parsedRecipient}  // ParsedAddress object
  selectedProduct={selectedProductData} 
/>
```

## Technical Details

### Country Display Logic

The country should only be displayed if it's not Germany. Check for:
- `"Deutschland"` (German spelling)
- `"Germany"` (English spelling)
- `"DE"` (ISO code for sender)

### Recipient Formatting Function

```typescript
const formatRecipientAddress = () => {
  const lines: string[] = [];
  
  // 1. Additional name first (company, c/o, etc.)
  if (parsedRecipient.additionalName) {
    lines.push(parsedRecipient.additionalName);
  }
  
  // 2. Name
  if (parsedRecipient.name) {
    lines.push(parsedRecipient.name);
  }
  
  // 3. Street
  if (parsedRecipient.street) {
    lines.push(parsedRecipient.street);
  }
  
  // 4. Address line 2 (apartment, floor, etc.)
  if (parsedRecipient.addressLine2) {
    lines.push(parsedRecipient.addressLine2);
  }
  
  // 5. ZIP and City
  if (parsedRecipient.zip || parsedRecipient.city) {
    lines.push(`${parsedRecipient.zip} ${parsedRecipient.city}`.trim());
  }
  
  // 6. Country (only if not Germany)
  const country = parsedRecipient.country;
  if (country && 
      country !== 'Deutschland' && 
      country !== 'Germany' && 
      country !== 'DE') {
    lines.push(country);
  }
  
  return lines.join('\n');
};
```

### Sender Formatting Update

```typescript
const formatSenderAddress = () => {
  const parts: string[] = [];
  
  // additionalName (company) - displayed as-is, not uppercase
  if (senderAddress.company) {
    parts.push(senderAddress.company);
  }
  
  parts.push(senderAddress.name);
  parts.push(senderAddress.street);
  parts.push(`${senderAddress.postalCode} ${senderAddress.city}`);
  
  // Country only if not Germany
  if (senderAddress.country && 
      senderAddress.country !== 'DE' && 
      senderAddress.country !== 'Deutschland' && 
      senderAddress.country !== 'Germany') {
    parts.push(senderAddress.country);
  }
  
  return parts.filter(Boolean).join(', ');
};
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/LabelPreview.tsx` | Update props to accept ParsedAddress, add recipient formatting with additionalName/addressLine2/country logic |
| `src/pages/Index.tsx` | Pass `parsedRecipient` instead of `recipientAddress` string to LabelPreview |

## Visual Result

The label preview will now show addresses in the correct order matching the actual Deutsche Post label format, with optional fields only appearing when they have values.
