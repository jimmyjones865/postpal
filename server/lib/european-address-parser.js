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

// Comprehensive country name mapping (name -> German display name)
// This must cover all countries users might type
const COUNTRY_NAME_MAP = {
  // Albania
  'albania': 'Albanien', 'albanien': 'Albanien', 'shqipëria': 'Albanien', 'shqiperia': 'Albanien',
  // Andorra
  'andorra': 'Andorra',
  // Austria
  'austria': 'Österreich', 'österreich': 'Österreich', 'oesterreich': 'Österreich', 'at': 'Österreich', 'aut': 'Österreich',
  // Belgium
  'belgium': 'Belgien', 'belgien': 'Belgien', 'belgië': 'Belgien', 'belgie': 'Belgien', 'belgique': 'Belgien', 'be': 'Belgien', 'bel': 'Belgien',
  // Bosnia
  'bosnia and herzegovina': 'Bosnien und Herzegowina', 'bosna i hercegovina': 'Bosnien und Herzegowina', 'bosnien und herzegowina': 'Bosnien und Herzegowina', 'bosnien': 'Bosnien und Herzegowina',
  // Bulgaria
  'bulgaria': 'Bulgarien', 'bulgarien': 'Bulgarien', 'българия': 'Bulgarien',
  // Belarus
  'belarus': 'Weißrussland', 'weißrussland': 'Weißrussland', 'weissrussland': 'Weißrussland',
  // Croatia
  'croatia': 'Kroatien', 'kroatien': 'Kroatien', 'hrvatska': 'Kroatien', 'hr': 'Kroatien', 'hrv': 'Kroatien',
  // Cyprus
  'cyprus': 'Zypern', 'zypern': 'Zypern', 'κύπρος': 'Zypern', 'kypros': 'Zypern', 'cy': 'Zypern', 'cyp': 'Zypern',
  // Czechia
  'czechia': 'Tschechien', 'czech republic': 'Tschechien', 'tschechien': 'Tschechien', 'česko': 'Tschechien', 'cesko': 'Tschechien', 'cz': 'Tschechien', 'cze': 'Tschechien',
  // Denmark
  'denmark': 'Dänemark', 'dänemark': 'Dänemark', 'daenemark': 'Dänemark', 'danmark': 'Dänemark', 'dk': 'Dänemark', 'dnk': 'Dänemark',
  // Estonia
  'estonia': 'Estland', 'estland': 'Estland', 'eesti': 'Estland', 'ee': 'Estland', 'est': 'Estland',
  // Finland
  'finland': 'Finnland', 'finnland': 'Finnland', 'suomi': 'Finnland', 'fi': 'Finnland', 'fin': 'Finnland',
  // France
  'france': 'Frankreich', 'frankreich': 'Frankreich', 'fr': 'Frankreich', 'fra': 'Frankreich',
  // Germany
  'germany': 'Deutschland', 'deutschland': 'Deutschland', 'de': 'Deutschland', 'deu': 'Deutschland',
  // Greece
  'greece': 'Griechenland', 'griechenland': 'Griechenland', 'ελλάδα': 'Griechenland', 'hellas': 'Griechenland', 'gr': 'Griechenland', 'grc': 'Griechenland',
  // Hungary
  'hungary': 'Ungarn', 'ungarn': 'Ungarn', 'magyarország': 'Ungarn', 'magyarorszag': 'Ungarn', 'hu': 'Ungarn', 'hun': 'Ungarn',
  // Iceland
  'iceland': 'Island', 'island': 'Island', 'ísland': 'Island', 'is': 'Island', 'isl': 'Island',
  // Ireland
  'ireland': 'Irland', 'irland': 'Irland', 'éire': 'Irland', 'eire': 'Irland', 'ie': 'Irland', 'irl': 'Irland',
  // Italy
  'italy': 'Italien', 'italien': 'Italien', 'italia': 'Italien', 'it': 'Italien', 'ita': 'Italien',
  // Latvia
  'latvia': 'Lettland', 'lettland': 'Lettland', 'latvija': 'Lettland', 'lv': 'Lettland', 'lva': 'Lettland',
  // Liechtenstein
  'liechtenstein': 'Liechtenstein', 'li': 'Liechtenstein', 'lie': 'Liechtenstein',
  // Lithuania
  'lithuania': 'Litauen', 'litauen': 'Litauen', 'lietuva': 'Litauen', 'lt': 'Litauen', 'ltu': 'Litauen',
  // Luxembourg
  'luxembourg': 'Luxemburg', 'luxemburg': 'Luxemburg', 'lëtzebuerg': 'Luxemburg', 'lu': 'Luxemburg', 'lux': 'Luxemburg',
  // Malta
  'malta': 'Malta', 'mt': 'Malta', 'mlt': 'Malta',
  // Moldova
  'moldova': 'Moldau', 'moldau': 'Moldau', 'md': 'Moldau', 'mda': 'Moldau',
  // Monaco
  'monaco': 'Monaco', 'mc': 'Monaco', 'mco': 'Monaco',
  // Montenegro
  'montenegro': 'Montenegro', 'crna gora': 'Montenegro', 'me': 'Montenegro', 'mne': 'Montenegro',
  // Netherlands
  'netherlands': 'Niederlande', 'niederlande': 'Niederlande', 'nederland': 'Niederlande', 'holland': 'Niederlande', 'nl': 'Niederlande', 'nld': 'Niederlande',
  // North Macedonia
  'north macedonia': 'Nordmazedonien', 'nordmazedonien': 'Nordmazedonien', 'macedonia': 'Nordmazedonien', 'makedonija': 'Nordmazedonien', 'mk': 'Nordmazedonien', 'mkd': 'Nordmazedonien',
  // Norway
  'norway': 'Norwegen', 'norwegen': 'Norwegen', 'norge': 'Norwegen', 'no': 'Norwegen', 'nor': 'Norwegen',
  // Poland
  'poland': 'Polen', 'polen': 'Polen', 'polska': 'Polen', 'pl': 'Polen', 'pol': 'Polen',
  // Portugal
  'portugal': 'Portugal', 'pt': 'Portugal', 'prt': 'Portugal',
  // Romania
  'romania': 'Rumänien', 'rumänien': 'Rumänien', 'rumaenien': 'Rumänien', 'românia': 'Rumänien', 'ro': 'Rumänien', 'rou': 'Rumänien',
  // Russia
  'russia': 'Russland', 'russland': 'Russland', 'россия': 'Russland', 'ru': 'Russland', 'rus': 'Russland',
  // San Marino
  'san marino': 'San Marino', 'sm': 'San Marino', 'smr': 'San Marino',
  // Serbia
  'serbia': 'Serbien', 'serbien': 'Serbien', 'srbija': 'Serbien', 'rs': 'Serbien', 'srb': 'Serbien',
  // Slovakia
  'slovakia': 'Slowakei', 'slowakei': 'Slowakei', 'slovensko': 'Slowakei', 'sk': 'Slowakei', 'svk': 'Slowakei',
  // Slovenia
  'slovenia': 'Slowenien', 'slowenien': 'Slowenien', 'slovenija': 'Slowenien', 'si': 'Slowenien', 'svn': 'Slowenien',
  // Spain
  'spain': 'Spanien', 'spanien': 'Spanien', 'españa': 'Spanien', 'espana': 'Spanien', 'es': 'Spanien', 'esp': 'Spanien',
  // Sweden
  'sweden': 'Schweden', 'schweden': 'Schweden', 'sverige': 'Schweden', 'se': 'Schweden', 'swe': 'Schweden',
  // Switzerland
  'switzerland': 'Schweiz', 'schweiz': 'Schweiz', 'suisse': 'Schweiz', 'svizzera': 'Schweiz', 'ch': 'Schweiz', 'che': 'Schweiz',
  // Turkey
  'turkey': 'Türkei', 'türkei': 'Türkei', 'tuerkei': 'Türkei', 'türkiye': 'Türkei', 'turkiye': 'Türkei', 'tr': 'Türkei', 'tur': 'Türkei',
  // Ukraine
  'ukraine': 'Ukraine', 'україна': 'Ukraine', 'ua': 'Ukraine', 'ukr': 'Ukraine',
  // United Kingdom
  'united kingdom': 'Vereinigtes Königreich', 'uk': 'Vereinigtes Königreich', 'great britain': 'Vereinigtes Königreich', 'britain': 'Vereinigtes Königreich', 'england': 'Vereinigtes Königreich', 'scotland': 'Vereinigtes Königreich', 'wales': 'Vereinigtes Königreich', 'northern ireland': 'Vereinigtes Königreich', 'gb': 'Vereinigtes Königreich', 'gbr': 'Vereinigtes Königreich', 'großbritannien': 'Vereinigtes Königreich', 'grossbritannien': 'Vereinigtes Königreich',
  // Vatican
  'vatican city': 'Vatikanstadt', 'vatican': 'Vatikanstadt', 'holy see': 'Vatikanstadt', 'vatikanstadt': 'Vatikanstadt', 'va': 'Vatikanstadt', 'vat': 'Vatikanstadt',
  // Non-European common destinations
  'usa': 'USA', 'united states': 'USA', 'vereinigte staaten': 'USA', 'amerika': 'USA', 'us': 'USA',
  'canada': 'Kanada', 'kanada': 'Kanada', 'ca': 'Kanada',
  'australia': 'Australien', 'australien': 'Australien', 'au': 'Australien',
  'new zealand': 'Neuseeland', 'neuseeland': 'Neuseeland', 'nz': 'Neuseeland',
  'japan': 'Japan', 'jp': 'Japan',
  'china': 'China', 'cn': 'China',
  'south korea': 'Südkorea', 'südkorea': 'Südkorea', 'suedkorea': 'Südkorea', 'korea': 'Südkorea', 'kr': 'Südkorea',
  'india': 'Indien', 'indien': 'Indien', 'in': 'Indien',
  'brazil': 'Brasilien', 'brasilien': 'Brasilien', 'br': 'Brasilien',
  'mexico': 'Mexiko', 'mexiko': 'Mexiko', 'mx': 'Mexiko',
  'south africa': 'Südafrika', 'südafrika': 'Südafrika', 'suedafrika': 'Südafrika', 'za': 'Südafrika',
  'singapore': 'Singapur', 'singapur': 'Singapur', 'sg': 'Singapur',
  'thailand': 'Thailand', 'th': 'Thailand',
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
 * Detect country from a string using comprehensive country name map
 */
function detectCountry(text) {
  const normalized = text.trim().toLowerCase();
  return COUNTRY_NAME_MAP[normalized] || null;
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
