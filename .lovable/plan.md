
# Plan: Preview Cropped Dimensions + Robust EU Address Parsing

This plan addresses two features:
1. **Preview Cropped Dimensions** - Show expected label size before printing
2. **Improve Address Parsing** - Make the parser robust for all EU countries without heavy libraries

---

## Feature 1: Preview Cropped Dimensions

### Problem
Users cannot see the final label dimensions before printing. This is especially important for endless roll paper where the height varies based on content.

### Solution
Add a new API endpoint that calculates cropped dimensions without actually cropping, and display this info in the Settings panel and/or before printing.

### Changes

| File | Change |
|------|--------|
| `server/routes/api.js` | Add `POST /api/labels/:id/dimensions` endpoint that calculates cropped size |
| `server/lib/pdf-cropper.js` | Export a `getContentDimensions()` function that returns bounds without modifying PDF |
| `src/components/SettingsPanel.tsx` | Add a "Preview Dimensions" button that fetches and displays the expected output size for a sample label |

### API Endpoint

```text
POST /api/labels/:id/dimensions
Body: { cropH: number, cropV: number, disableCropping: boolean }

Response: {
  original: { widthMm: number, heightMm: number },
  cropped: { widthMm: number, heightMm: number } | null
}
```

### UI Display
Show dimensions like: "Cropped size: 88.0 x 42.5 mm" near the crop margin settings.

---

## Feature 2: Robust EU Address Parsing

### Current State
The existing parser in `server/lib/european-address-parser.js` handles ~15 EU countries with regex patterns for postal codes. It works well for standard formats but has gaps:
- Missing postal code patterns for some countries (Portugal, Greece, Swedish format, etc.)
- No confidence scoring to handle ambiguous input
- Limited handling of multi-line variations

### Options Considered

| Option | Size | Pros | Cons |
|--------|------|------|------|
| **libpostal** | ~2GB | Most accurate, ML-trained | Massive, complex deployment |
| **Google Address API** | External | Very accurate | Costs money, requires API key |
| **lib-address** | ~2.5KB | Metadata for 200+ countries | Format templates only, no parsing |
| **Custom regex enhancement** | 0KB (existing) | No dependencies, full control | Requires manual maintenance |
| **Hybrid: Enhanced regex + heuristics** | ~10KB | Good accuracy, lightweight | Some edge cases |

### Recommended Approach: Enhanced Regex Parser

Improve the existing parser with:

1. **Complete postal code patterns** for all 27 EU countries + EEA + common destinations
2. **Country detection from postal code format** (e.g., Dutch 4-digit+2-letter is unmistakable)
3. **Street suffix dictionaries** for more languages
4. **Confidence scoring** to indicate parsing quality
5. **Better multi-line handling** for varying input formats

### Detailed Changes

#### 1. Expanded Postal Code Patterns

Add patterns for missing countries:

| Country | Pattern | Example |
|---------|---------|---------|
| Portugal | `\d{4}-\d{3}` | 1000-001 Lisboa |
| Greece | `\d{3}\s?\d{2}` | 106 82 Athens |
| Sweden | `\d{3}\s?\d{2}` | 114 34 Stockholm |
| Finland | `\d{5}` | 00100 Helsinki |
| Czech | `\d{3}\s?\d{2}` | 110 00 Praha |
| Slovakia | `\d{3}\s?\d{2}` | 811 01 Bratislava |
| Hungary | `\d{4}` | 1051 Budapest |
| Romania | `\d{6}` | 010011 Bucharest |
| Bulgaria | `\d{4}` | 1000 Sofia |
| Croatia | `\d{5}` | 10000 Zagreb |
| Slovenia | `\d{4}` | 1000 Ljubljana |
| Latvia | `LV-\d{4}` | LV-1050 Riga |
| Lithuania | `LT-\d{5}` | LT-01100 Vilnius |
| Estonia | `\d{5}` | 10111 Tallinn |
| Cyprus | `\d{4}` | 1095 Nicosia |
| Malta | `[A-Z]{3}\s?\d{4}` | VLT 1000 |
| Luxembourg | `L-\d{4}` or `\d{4}` | L-1471 or 1471 |

#### 2. Smarter Country Detection

```text
Algorithm:
1. Check if last line is a known country name → use that
2. If no explicit country, infer from postal code format:
   - Dutch pattern (1234 AB) → Netherlands
   - Polish pattern (00-000) → Poland
   - Irish Eircode → Ireland
   - UK postcode → UK
   - Portuguese pattern (1234-567) → Portugal
   - Latvian prefix (LV-) → Latvia
   - Lithuanian prefix (LT-) → Lithuania
3. Default to Germany if ambiguous 5-digit code
```

#### 3. Expanded Street Detection

Add suffixes for more languages:

```javascript
const STREET_SUFFIXES = {
  // German (existing)
  de: ['straße', 'strasse', 'str', 'weg', 'platz', 'allee', 'gasse', 'ring', 'damm', 'ufer', 'chaussee'],
  // French
  fr: ['rue', 'avenue', 'boulevard', 'place', 'chemin', 'allée', 'impasse', 'passage', 'quai'],
  // Spanish
  es: ['calle', 'avenida', 'plaza', 'paseo', 'carrer', 'carrera', 'camino'],
  // Italian
  it: ['via', 'viale', 'piazza', 'corso', 'vicolo', 'largo', 'piazzale'],
  // Portuguese
  pt: ['rua', 'avenida', 'praça', 'travessa', 'largo', 'alameda'],
  // Dutch (existing)
  nl: ['straat', 'laan', 'weg', 'plein', 'gracht', 'kade', 'singel'],
  // Polish (existing)
  pl: ['ulica', 'ul', 'aleja', 'al', 'plac'],
  // Czech/Slovak
  cs: ['ulice', 'ul', 'náměstí', 'nám', 'třída', 'tř'],
  // Hungarian
  hu: ['utca', 'u', 'út', 'tér', 'körút', 'köz'],
  // Romanian
  ro: ['strada', 'str', 'bulevardul', 'bd', 'piața', 'calea'],
  // Nordic
  nordic: ['gatan', 'vägen', 'gade', 'vej', 'veien', 'gate', 'katu', 'tie'],
  // Greek (transliterated)
  gr: ['odos', 'leoforos', 'plateia'],
  // English (existing)
  en: ['street', 'road', 'avenue', 'lane', 'drive', 'way', 'court', 'close', 'crescent']
};
```

#### 4. Confidence Scoring

Return a confidence score (0-100) indicating parsing quality:

```javascript
// Add to parseAddress return object:
{
  ...fields,
  confidence: 85,
  warnings: ['Could not detect country, defaulting to Germany']
}
```

Scoring factors:
- Postal code matched known pattern: +30
- Country explicitly provided: +20
- Street suffix recognized: +20
- Name line detected (at least 2 words): +15
- ZIP+City on same line: +15

### Files to Modify

| File | Changes |
|------|---------|
| `server/lib/european-address-parser.js` | Add postal patterns, street suffixes, confidence scoring, country inference |
| `src/lib/address.ts` | Add `confidence?: number` and `warnings?: string[]` to ParsedAddress interface |
| `src/components/ParsedAddressEditor.tsx` | Display confidence indicator and warnings |

---

## Technical Notes

### Why Not External Libraries?

- **libpostal**: 2GB+ in size, requires C compilation, not practical for this use case
- **Google Places API**: Costs money per request, requires API key management
- **OpenCage/Nominatim**: Geocoding services, not address parsers - require full valid addresses

### Accuracy Trade-offs

The enhanced regex approach will handle ~95% of EU addresses correctly. Edge cases that may fail:
- Addresses without postal codes
- Unusual multi-line formats
- Non-Latin scripts (Greek, Cyrillic) - will need transliteration

### Maintenance

The postal code patterns are standardized by each country's postal service and rarely change. The country name mapping already covers multiple languages and can be extended.

---

## Implementation Order

1. Add cropped dimensions preview endpoint and UI
2. Expand postal code patterns for all EU countries
3. Add street suffix dictionaries for major EU languages  
4. Implement country inference from postal code format
5. Add confidence scoring
6. Display parsing confidence in UI
