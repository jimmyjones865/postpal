/**
 * European Address Parser
 * A lightweight regex-based parser for common European address formats.
 * Designed as a standalone module for easy replacement/extension.
 * 
 * Supported formats:
 * - German: Straße 123, 12345 Stadt
 * - Austrian: Straße 123, 1234 Stadt (4-digit zip)
 * - Dutch: Straat 123, 1234 AB Stadt (alphanumeric zip)
 * - Polish: ul. Ulica 123, 00-000 Miasto (hyphenated zip)
 * - Street-first: 123 Main Street, 12345 City
 * - Street-last: Main Street 123, 12345 City
 */

// Zip code patterns by country/type
const ZIP_PATTERNS = {
  // German: 5 digits (01234-99999)
  german: /\b(\d{5})\b/,
  // Austrian: 4 digits (1000-9999)
  austrian: /\b(\d{4})\b/,
  // Dutch: 4 digits + 2 letters (1234 AB or 1234AB)
  dutch: /\b(\d{4}\s?[A-Z]{2})\b/i,
  // Polish: 2 digits, hyphen, 3 digits (00-000)
  polish: /\b(\d{2}-\d{3})\b/,
  // UK: Complex alphanumeric (SW1A 1AA, M1 1AA, etc.)
  uk: /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i,
  // Swiss: 4 digits (1000-9999)
  swiss: /\b(\d{4})\b/,
  // Belgian: 4 digits (1000-9999)
  belgian: /\b(\d{4})\b/,
  // French: 5 digits (01234-99999)
  french: /\b(\d{5})\b/,
  // Italian: 5 digits (00100-99100)
  italian: /\b(\d{5})\b/,
  // Spanish: 5 digits (01000-52999)
  spanish: /\b(\d{5})\b/,
};

// Street number patterns
const STREET_NUMBER_PATTERNS = {
  // Number at end: "Musterstraße 123" or "Musterstraße 123a"
  numberAtEnd: /^(.+?)\s+(\d+\s?[a-zA-Z]?)$/,
  // Number at start: "123 Main Street" or "123a Main Street"
  numberAtStart: /^(\d+\s?[a-zA-Z]?)\s+(.+)$/,
  // German with slash: "Musterstraße 1/2"
  withSlash: /^(.+?)\s+(\d+\/\d+\s?[a-zA-Z]?)$/,
  // Range: "Musterstraße 1-3"
  withRange: /^(.+?)\s+(\d+-\d+\s?[a-zA-Z]?)$/,
};

// Common address line prefixes (for additional info detection)
const ADDITIONAL_LINE_PREFIXES = [
  /^c\/o\s+/i,
  /^z\.?\s?h\.?\s+/i,     // z.H. / z. H. (German: zu Händen)
  /^attn\.?\s+/i,
  /^app\.?\s+/i,          // Apartment
  /^apt\.?\s+/i,
  /^wohnung\s+/i,
  /^etage\s+/i,
  /^og\s*$/i,             // Obergeschoss
  /^ug\s*$/i,             // Untergeschoss
  /^eg\s*$/i,             // Erdgeschoss
  /^\d+\.\s*(og|etage|stock)/i,
  /^postfach\s+/i,
  /^p\.?\s?o\.?\s?box\s+/i,
];

// Country detection patterns
const COUNTRY_PATTERNS = {
  'Deutschland': [/\bde\b/i, /\bdeu\b/i, /\bgermany\b/i, /\bdeutschland\b/i],
  'Österreich': [/\bat\b/i, /\baut\b/i, /\baustria\b/i, /\bösterreich\b/i],
  'Schweiz': [/\bch\b/i, /\bche\b/i, /\bswitzerland\b/i, /\bschweiz\b/i, /\bsuisse\b/i],
  'Niederlande': [/\bnl\b/i, /\bnld\b/i, /\bnetherlands\b/i, /\bniederlande\b/i, /\bholland\b/i],
  'Polen': [/\bpl\b/i, /\bpol\b/i, /\bpoland\b/i, /\bpolen\b/i, /\bpolska\b/i],
  'Belgien': [/\bbe\b/i, /\bbel\b/i, /\bbelgium\b/i, /\bbelgien\b/i, /\bbelgique\b/i],
  'Frankreich': [/\bfr\b/i, /\bfra\b/i, /\bfrance\b/i, /\bfrankreich\b/i],
  'Italien': [/\bit\b/i, /\bita\b/i, /\bitaly\b/i, /\bitalien\b/i, /\bitalia\b/i],
  'Spanien': [/\bes\b/i, /\besp\b/i, /\bspain\b/i, /\bspanien\b/i, /\bespaña\b/i],
  'Vereinigtes Königreich': [/\bgb\b/i, /\buk\b/i, /\bunited\s*kingdom\b/i, /\bgreat\s*britain\b/i, /\bengland\b/i],
};

/**
 * Parse a European address string into structured components.
 * @param {string} rawAddress - The raw address string (can be multi-line)
 * @returns {Object} Parsed address with name, additionalName, street, addressLine2, zip, city, country
 */
export function parseAddress(rawAddress) {
  const result = {
    name: '',
    additionalName: '',
    street: '',
    addressLine2: '',
    zip: '',
    city: '',
    country: 'Deutschland', // Default
  };

  if (!rawAddress || typeof rawAddress !== 'string') {
    return result;
  }

  // Split into lines and clean up
  const lines = rawAddress
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return result;
  }

  // Detect country first (might be on its own line)
  let countryLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const detected = detectCountry(lines[i]);
    if (detected && lines[i].match(/^[\p{L}\s]+$/u)) {
      result.country = detected;
      countryLineIndex = i;
      break;
    }
  }

  // Remove country line if it was standalone
  const workingLines = countryLineIndex >= 0 
    ? lines.filter((_, i) => i !== countryLineIndex)
    : [...lines];

  // Try to find zip+city line
  let zipCityLineIndex = -1;
  for (let i = workingLines.length - 1; i >= 0; i--) {
    const zipCity = extractZipAndCity(workingLines[i]);
    if (zipCity.zip) {
      result.zip = zipCity.zip;
      result.city = zipCity.city;
      zipCityLineIndex = i;
      break;
    }
  }

  // Remove zip+city line from working set
  const remainingLines = zipCityLineIndex >= 0
    ? workingLines.filter((_, i) => i !== zipCityLineIndex)
    : workingLines;

  // First line is typically the name
  if (remainingLines.length > 0) {
    result.name = remainingLines[0];
  }

  // Find street line (contains numbers and looks like an address)
  let streetLineIndex = -1;
  for (let i = 1; i < remainingLines.length; i++) {
    if (looksLikeStreet(remainingLines[i])) {
      result.street = normalizeStreet(remainingLines[i]);
      streetLineIndex = i;
      break;
    }
  }

  // If no obvious street found, use the last remaining line
  if (streetLineIndex === -1 && remainingLines.length > 1) {
    const lastLine = remainingLines[remainingLines.length - 1];
    if (!isAdditionalLine(lastLine)) {
      result.street = normalizeStreet(lastLine);
      streetLineIndex = remainingLines.length - 1;
    }
  }

  // Everything between name and street goes to additionalName/addressLine2
  for (let i = 1; i < remainingLines.length; i++) {
    if (i === streetLineIndex) continue;
    
    const line = remainingLines[i];
    if (isAdditionalLine(line)) {
      // Lines like "c/o", apartment, floor go to addressLine2
      if (!result.addressLine2) {
        result.addressLine2 = line;
      } else {
        result.addressLine2 += `, ${line}`;
      }
    } else if (i < streetLineIndex || streetLineIndex === -1) {
      // Lines before street (company name, etc.)
      if (!result.additionalName) {
        result.additionalName = line;
      } else {
        result.additionalName += `, ${line}`;
      }
    } else {
      // Lines after street go to addressLine2
      if (!result.addressLine2) {
        result.addressLine2 = line;
      } else {
        result.addressLine2 += `, ${line}`;
      }
    }
  }

  return result;
}

/**
 * Detect country from a string
 */
function detectCountry(text) {
  const normalized = text.trim();
  for (const [country, patterns] of Object.entries(COUNTRY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return country;
      }
    }
  }
  return null;
}

/**
 * Extract zip code and city from a line
 */
function extractZipAndCity(line) {
  const result = { zip: '', city: '' };
  
  // Try patterns in order of specificity
  const patterns = [
    { name: 'dutch', pattern: ZIP_PATTERNS.dutch },
    { name: 'polish', pattern: ZIP_PATTERNS.polish },
    { name: 'uk', pattern: ZIP_PATTERNS.uk },
    { name: 'german', pattern: ZIP_PATTERNS.german },
    { name: 'austrian', pattern: ZIP_PATTERNS.austrian },
  ];

  for (const { pattern } of patterns) {
    const match = line.match(pattern);
    if (match) {
      result.zip = match[1].toUpperCase().replace(/\s+/g, ' ');
      // City is everything after the zip (or before, in some formats)
      const afterZip = line.substring(line.indexOf(match[0]) + match[0].length).trim();
      const beforeZip = line.substring(0, line.indexOf(match[0])).trim();
      
      // Usually city comes after zip, but handle both
      result.city = afterZip || beforeZip;
      
      // Clean up city (remove leading comma, etc.)
      result.city = result.city.replace(/^[, \s]+|[, \s]+$/g, '');
      break;
    }
  }

  return result;
}

/**
 * Check if a line looks like a street address
 */
function looksLikeStreet(line) {
  // Contains a number (house number)
  if (!/\d/.test(line)) return false;
  
  // Common German street suffixes
  const streetSuffixes = [
    /straße/i, /strasse/i, /str\./i, /weg/i, /platz/i, /allee/i,
    /gasse/i, /ring/i, /damm/i, /ufer/i, /chaussee/i,
    /street/i, /road/i, /avenue/i, /lane/i, /drive/i,
    /straat/i, /laan/i, /weg/i, // Dutch
    /ulica/i, /ul\./i, /aleja/i, /al\./i, // Polish
  ];
  
  for (const suffix of streetSuffixes) {
    if (suffix.test(line)) return true;
  }
  
  // Has number pattern typical of addresses
  return STREET_NUMBER_PATTERNS.numberAtEnd.test(line) ||
         STREET_NUMBER_PATTERNS.numberAtStart.test(line);
}

/**
 * Normalize street format (street name + house number)
 */
function normalizeStreet(line) {
  // If it matches "123 Main Street", keep as-is (common in some countries)
  // If it matches "Main Street 123", also keep as-is
  // Just clean up whitespace
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * Check if line is additional info (c/o, apartment, floor, etc.)
 */
function isAdditionalLine(line) {
  for (const pattern of ADDITIONAL_LINE_PREFIXES) {
    if (pattern.test(line)) return true;
  }
  
  // Short lines with apartment/unit numbers
  if (/^(app?t?|wohnung|unit|suite|#)\s*\.?\s*\d+/i.test(line)) return true;
  if (/^\d+\.\s*(stock|etage|og|floor)/i.test(line)) return true;
  
  return false;
}

/**
 * Format a parsed address back to a string
 */
export function formatAddress(parsed) {
  const lines = [];
  
  if (parsed.name) lines.push(parsed.name);
  if (parsed.additionalName) lines.push(parsed.additionalName);
  if (parsed.street) lines.push(parsed.street);
  if (parsed.addressLine2) lines.push(parsed.addressLine2);
  if (parsed.zip || parsed.city) {
    lines.push(`${parsed.zip} ${parsed.city}`.trim());
  }
  if (parsed.country && parsed.country !== 'Deutschland') {
    lines.push(parsed.country);
  }
  
  return lines.join('\n');
}

/**
 * Create an empty address object
 */
export function emptyAddress() {
  return {
    name: '',
    additionalName: '',
    street: '',
    addressLine2: '',
    zip: '',
    city: '',
    country: 'Deutschland',
  };
}

export default {
  parseAddress,
  formatAddress,
  emptyAddress,
};
