
# Full Address Parsing for EU/EEA + UK Countries

## Current Status

Both parsing systems already have solid coverage for most countries. After analysis, I found a few gaps that need to be addressed.

## Gaps Identified

### 1. Missing Postal Code Patterns

| Country | Format | Current State |
|---------|--------|---------------|
| Denmark | 4 digits (1000-9999) | Falls into ambiguous `fourDigit` - no specific pattern |
| Norway | 4 digits (0001-9999) | Falls into ambiguous `fourDigit` - no specific pattern |
| Iceland | 3 digits (101-999) | No pattern at all |

### 2. Missing Street Suffixes

| Country | Missing Suffixes |
|---------|-----------------|
| Bulgaria | улица (ulitsa), булевард (bulevard), площад (ploshtad) |
| Cyprus | Already covered by Greek (`gr`) suffixes |

## Implementation Plan

### File: `server/lib/european-address-parser.js`

**1. Add Icelandic postal code pattern**
```javascript
// Iceland: 3 digits (101-999)
icelandic: { pattern: /\b(\d{3})\b/, country: 'Island' },
```

**2. Add Icelandic street suffixes**
```javascript
// Icelandic
is: ['vegur', 'gata', 'stræti', 'straeti', 'braut', 'torg', 'laugavegur']
```

**3. Add Bulgarian street suffixes (transliterated)**
```javascript
// Bulgarian (transliterated)
bg: ['ulitsa', 'ul', 'bulevard', 'bul', 'ploshtad', 'pl', 'улица', 'ул', 'булевард', 'бул', 'площад', 'пл']
```

**4. Update ZIP_PATTERN_ORDER**

Add `icelandic` to the pattern order before `fourDigit` to ensure 3-digit codes are checked.

### Summary of Changes

| Change | Location | Lines |
|--------|----------|-------|
| Add `icelandic` postal pattern | ZIP_PATTERNS object | ~line 45 |
| Update ZIP_PATTERN_ORDER | Array | line 62-66 |
| Add Icelandic street suffixes | STREET_SUFFIXES object | ~line 95 |
| Add Bulgarian street suffixes | STREET_SUFFIXES object | ~line 97 |

## Technical Notes

- Denmark and Norway use 4-digit codes which are already matched by `fourDigit` pattern. Making them specific would require checking for digit ranges (DK: 1000-9999, NO: 0001-9999) which overlap with other countries. The current approach of requiring explicit country names for these is the safest approach.

- The `fourDigit` pattern is intentionally ambiguous because Austria, Belgium, Switzerland, Hungary, Bulgaria, Slovenia, Cyprus, Denmark, and Norway all use 4-digit postal codes that overlap. Country inference only works for unique formats like Dutch (1234 AB) or Polish (12-345).

- Iceland's 3-digit postal codes are unique in Europe, so we can add a specific pattern with country inference.

## Files to Modify

| File | Changes |
|------|---------|
| `server/lib/european-address-parser.js` | Add Icelandic postal pattern, Bulgarian + Icelandic street suffixes |

