/**
 * European Address Parser v2.0
 * A lightweight but comprehensive regex-based parser for European address formats.
 * 
 * Features:
 * - Complete postal code patterns for all 27 EU countries + EEA + common destinations
 * - Country inference from postal code format
 * - Street suffix detection for 12+ languages
 * - Confidence scoring (0-100)
 * - Multi-line format handling
 */

// ============================================================
// POSTAL CODE PATTERNS BY COUNTRY
// ============================================================

const ZIP_PATTERNS = {
  // Ireland: Eircode - 3 alphanumeric + space + 4 alphanumeric (A65 F4E2, D01 F5P2)
  irish: { pattern: /\b([A-Z]\d[\dWX]\s?[A-Z\d]{4})\b/i, country: 'Irland' },
  
  // UK: Complex alphanumeric (SW1A 1AA, M1 1AA, B1 1AA)
  uk: { pattern: /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i, country: 'Vereinigtes Königreich' },
  
  // Netherlands: 4 digits + 2 letters (1234 AB or 1234AB)
  dutch: { pattern: /\b(\d{4}\s?[A-Z]{2})\b/i, country: 'Niederlande' },
  
  // Poland: 2 digits-3 digits (00-000)
  polish: { pattern: /\b(\d{2}-\d{3})\b/, country: 'Polen' },
  
  // Portugal: 4 digits-3 digits (1000-001)
  portuguese: { pattern: /\b(\d{4}-\d{3})\b/, country: 'Portugal' },
  
  // Latvia: LV-4 digits (LV-1050)
  latvian: { pattern: /\b(LV-\d{4})\b/i, country: 'Lettland' },
  
  // Lithuania: LT-5 digits (LT-01100)
  lithuanian: { pattern: /\b(LT-\d{5})\b/i, country: 'Litauen' },
  
  // Malta: 3 letters + 4 digits (VLT 1000)
  maltese: { pattern: /\b([A-Z]{3}\s?\d{4})\b/i, country: 'Malta' },
  
  // Luxembourg: L-4 digits or just 4 digits (L-1471)
  luxembourg: { pattern: /\b(L-\d{4})\b/i, country: 'Luxemburg' },
  
  // Romania: 6 digits (010011)
  romanian: { pattern: /\b(\d{6})\b/, country: 'Rumänien' },
  
  // Greece/Sweden/Finland/Czech/Slovakia: 3+2 format with optional space (123 45)
  nordic_cz: { pattern: /\b(\d{3}\s\d{2})\b/, country: null }, // Ambiguous - need context
  
  // Germany/France/Italy/Spain: 5 digits (01234-99999)
  fiveDigit: { pattern: /\b(\d{5})\b/, country: null }, // Ambiguous
  
  // Austria/Switzerland/Belgium/Hungary/Bulgaria/Slovenia/Cyprus: 4 digits
  fourDigit: { pattern: /\b(\d{4})\b/, country: null }, // Ambiguous
  
  // Croatia/Estonia: 5 digits (10000)
  croatian: { pattern: /\b(\d{5})\b/, country: null }, // Same as 5-digit, use context
};

// Order of pattern checking - most specific first
const ZIP_PATTERN_ORDER = [
  'irish', 'uk', 'dutch', 'polish', 'portuguese', 
  'latvian', 'lithuanian', 'maltese', 'luxembourg',
  'romanian', 'nordic_cz', 'fiveDigit', 'fourDigit'
];

// ============================================================
// STREET SUFFIXES BY LANGUAGE
// ============================================================

const STREET_SUFFIXES = {
  // German
  de: ['straße', 'strasse', 'str', 'weg', 'platz', 'allee', 'gasse', 'ring', 'damm', 'ufer', 'chaussee', 'steig', 'hof', 'park'],
  // French
  fr: ['rue', 'avenue', 'boulevard', 'place', 'chemin', 'allée', 'allee', 'impasse', 'passage', 'quai', 'route', 'voie'],
  // Spanish/Catalan
  es: ['calle', 'avenida', 'plaza', 'paseo', 'carrer', 'carrera', 'camino', 'rambla', 'via', 'travesía', 'travesia'],
  // Italian
  it: ['via', 'viale', 'piazza', 'corso', 'vicolo', 'largo', 'piazzale', 'lungotevere', 'lungarno'],
  // Portuguese
  pt: ['rua', 'avenida', 'praça', 'praca', 'travessa', 'largo', 'alameda', 'estrada'],
  // Dutch/Flemish
  nl: ['straat', 'laan', 'weg', 'plein', 'gracht', 'kade', 'singel', 'steeg', 'dijk', 'dreef'],
  // Polish
  pl: ['ulica', 'ul', 'aleja', 'al', 'plac', 'skwer', 'rondo'],
  // Czech/Slovak
  cs: ['ulice', 'ul', 'náměstí', 'namesti', 'nám', 'nam', 'třída', 'trida', 'tř', 'tr'],
  // Hungarian
  hu: ['utca', 'u', 'út', 'ut', 'tér', 'ter', 'körút', 'korut', 'köz', 'koz', 'fasor'],
  // Romanian
  ro: ['strada', 'str', 'bulevardul', 'bd', 'piața', 'piata', 'calea', 'aleea', 'intrarea'],
  // Nordic (Swedish/Danish/Norwegian/Finnish)
  nordic: ['gatan', 'gata', 'vägen', 'vagen', 'väg', 'vag', 'gade', 'vej', 'veien', 'gate', 'plass', 'katu', 'tie', 'tori'],
  // Greek (transliterated)
  gr: ['odos', 'leoforos', 'plateia', 'odoς'],
  // Baltic (Estonian/Latvian/Lithuanian)
  baltic: ['tänav', 'tanav', 'tee', 'iela', 'bulvāris', 'bulvaris', 'gatvė', 'gatve', 'prospektas', 'aikštė', 'aikste'],
  // Slavic (Croatian/Slovenian/Serbian)
  slavic: ['ulica', 'ul', 'cesta', 'trg', 'avenija', 'put'],
  // English
  en: ['street', 'st', 'road', 'rd', 'avenue', 'ave', 'lane', 'ln', 'drive', 'dr', 'way', 'court', 'ct', 'close', 'crescent', 'terrace', 'place', 'square']
};

// Flatten all suffixes for quick lookup
const ALL_STREET_SUFFIXES = Object.values(STREET_SUFFIXES).flat();

// ============================================================
// STREET NUMBER PATTERNS
// ============================================================

const STREET_NUMBER_PATTERNS = {
  // Number at end: "Musterstraße 123" or "Musterstraße 123a" or "Musterstraße 123 A"
  numberAtEnd: /^(.+?)\s+(\d+\s?[a-zA-Z]?)$/,
  // Number at start: "123 Main Street" or "123a Main Street"
  numberAtStart: /^(\d+\s?[a-zA-Z]?)\s+(.+)$/,
  // German with slash: "Musterstraße 1/2"
  withSlash: /^(.+?)\s+(\d+\/\d+\s?[a-zA-Z]?)$/,
  // Range: "Musterstraße 1-3"
  withRange: /^(.+?)\s+(\d+-\d+\s?[a-zA-Z]?)$/,
};

// ============================================================
// ADDITIONAL LINE DETECTION PREFIXES
// ============================================================

const ADDITIONAL_LINE_PREFIXES = [
  /^c\/o\s+/i,
  /^z\.?\s?h\.?\s+/i,     // z.H. / z. H. (German: zu Händen)
  /^attn\.?\s*:?\s*/i,
  /^attention\s*:?\s*/i,
  /^app\.?\s+/i,          // Apartment
  /^apt\.?\s*/i,
  /^apartment\s*/i,
  /^wohnung\s*/i,
  /^whg\.?\s*/i,
  /^etage\s*/i,
  /^stock\s*/i,
  /^floor\s*/i,
  /^og\s*$/i,             // Obergeschoss
  /^ug\s*$/i,             // Untergeschoss
  /^eg\s*$/i,             // Erdgeschoss
  /^dg\s*$/i,             // Dachgeschoss
  /^\d+\.\s*(og|etage|stock|floor)/i,
  /^postfach\s+/i,
  /^p\.?\s?o\.?\s?box\s*/i,
  /^boîte\s+postale/i,    // French P.O. Box
  /^casella\s+postale/i,  // Italian P.O. Box
  /^apartado\s*/i,        // Spanish P.O. Box
  /^unit\s+/i,
  /^suite\s+/i,
  /^ste\.?\s+/i,
  /^building\s+/i,
  /^bldg\.?\s+/i,
  /^gebäude\s+/i,
  /^bâtiment\s+/i,
  /^edificio\s+/i,
];

// ============================================================
// COUNTRY NAME MAPPING (name -> German display name)
// ============================================================

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
  'belarus': 'Weißrussland', 'weißrussland': 'Weißrussland', 'weissrussland': 'Weißrussland', 'беларусь': 'Weißrussland',
  // Croatia
  'croatia': 'Kroatien', 'kroatien': 'Kroatien', 'hrvatska': 'Kroatien', 'hr': 'Kroatien', 'hrv': 'Kroatien',
  // Cyprus
  'cyprus': 'Zypern', 'zypern': 'Zypern', 'κύπρος': 'Zypern', 'kypros': 'Zypern', 'kibris': 'Zypern', 'cy': 'Zypern', 'cyp': 'Zypern',
  // Czechia
  'czechia': 'Tschechien', 'czech republic': 'Tschechien', 'tschechien': 'Tschechien', 'česko': 'Tschechien', 'cesko': 'Tschechien', 'česká republika': 'Tschechien', 'cz': 'Tschechien', 'cze': 'Tschechien',
  // Denmark
  'denmark': 'Dänemark', 'dänemark': 'Dänemark', 'daenemark': 'Dänemark', 'danmark': 'Dänemark', 'dk': 'Dänemark', 'dnk': 'Dänemark',
  // Estonia
  'estonia': 'Estland', 'estland': 'Estland', 'eesti': 'Estland', 'ee': 'Estland', 'est': 'Estland',
  // Finland
  'finland': 'Finnland', 'finnland': 'Finnland', 'suomi': 'Finnland', 'fi': 'Finnland', 'fin': 'Finnland',
  // France
  'france': 'Frankreich', 'frankreich': 'Frankreich', 'fr': 'Frankreich', 'fra': 'Frankreich',
  // Germany
  'germany': 'Deutschland', 'deutschland': 'Deutschland', 'de': 'Deutschland', 'deu': 'Deutschland', 'alemania': 'Deutschland', 'allemagne': 'Deutschland', 'germania': 'Deutschland',
  // Greece
  'greece': 'Griechenland', 'griechenland': 'Griechenland', 'ελλάδα': 'Griechenland', 'ellada': 'Griechenland', 'hellas': 'Griechenland', 'gr': 'Griechenland', 'grc': 'Griechenland',
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
  'luxembourg': 'Luxemburg', 'luxemburg': 'Luxemburg', 'lëtzebuerg': 'Luxemburg', 'letzebuerg': 'Luxemburg', 'lu': 'Luxemburg', 'lux': 'Luxemburg',
  // Malta
  'malta': 'Malta', 'mt': 'Malta', 'mlt': 'Malta',
  // Moldova
  'moldova': 'Moldau', 'moldau': 'Moldau', 'md': 'Moldau', 'mda': 'Moldau',
  // Monaco
  'monaco': 'Monaco', 'mc': 'Monaco', 'mco': 'Monaco',
  // Montenegro
  'montenegro': 'Montenegro', 'crna gora': 'Montenegro', 'me': 'Montenegro', 'mne': 'Montenegro',
  // Netherlands
  'netherlands': 'Niederlande', 'niederlande': 'Niederlande', 'nederland': 'Niederlande', 'holland': 'Niederlande', 'nl': 'Niederlande', 'nld': 'Niederlande', 'the netherlands': 'Niederlande',
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
  'russia': 'Russland', 'russland': 'Russland', 'россия': 'Russland', 'rossiya': 'Russland', 'ru': 'Russland', 'rus': 'Russland',
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
  'switzerland': 'Schweiz', 'schweiz': 'Schweiz', 'suisse': 'Schweiz', 'svizzera': 'Schweiz', 'svizra': 'Schweiz', 'ch': 'Schweiz', 'che': 'Schweiz',
  // Turkey
  'turkey': 'Türkei', 'türkei': 'Türkei', 'tuerkei': 'Türkei', 'türkiye': 'Türkei', 'turkiye': 'Türkei', 'tr': 'Türkei', 'tur': 'Türkei',
  // Ukraine
  'ukraine': 'Ukraine', 'україна': 'Ukraine', 'ukraina': 'Ukraine', 'ua': 'Ukraine', 'ukr': 'Ukraine',
  // United Kingdom
  'united kingdom': 'Vereinigtes Königreich', 'uk': 'Vereinigtes Königreich', 'great britain': 'Vereinigtes Königreich', 'britain': 'Vereinigtes Königreich', 'england': 'Vereinigtes Königreich', 'scotland': 'Vereinigtes Königreich', 'wales': 'Vereinigtes Königreich', 'northern ireland': 'Vereinigtes Königreich', 'gb': 'Vereinigtes Königreich', 'gbr': 'Vereinigtes Königreich', 'großbritannien': 'Vereinigtes Königreich', 'grossbritannien': 'Vereinigtes Königreich',
  // Vatican
  'vatican city': 'Vatikanstadt', 'vatican': 'Vatikanstadt', 'holy see': 'Vatikanstadt', 'vatikanstadt': 'Vatikanstadt', 'va': 'Vatikanstadt', 'vat': 'Vatikanstadt',
  // Non-European common destinations
  'usa': 'USA', 'united states': 'USA', 'united states of america': 'USA', 'vereinigte staaten': 'USA', 'amerika': 'USA', 'us': 'USA', 'america': 'USA',
  'canada': 'Kanada', 'kanada': 'Kanada', 'ca': 'Kanada',
  'australia': 'Australien', 'australien': 'Australien', 'au': 'Australien',
  'new zealand': 'Neuseeland', 'neuseeland': 'Neuseeland', 'nz': 'Neuseeland', 'aotearoa': 'Neuseeland',
  'japan': 'Japan', 'jp': 'Japan', '日本': 'Japan',
  'china': 'China', 'cn': 'China', '中国': 'China',
  'south korea': 'Südkorea', 'südkorea': 'Südkorea', 'suedkorea': 'Südkorea', 'korea': 'Südkorea', 'kr': 'Südkorea',
  'india': 'Indien', 'indien': 'Indien', 'in': 'Indien',
  'brazil': 'Brasilien', 'brasilien': 'Brasilien', 'brasil': 'Brasilien', 'br': 'Brasilien',
  'mexico': 'Mexiko', 'mexiko': 'Mexiko', 'méxico': 'Mexiko', 'mx': 'Mexiko',
  'south africa': 'Südafrika', 'südafrika': 'Südafrika', 'suedafrika': 'Südafrika', 'za': 'Südafrika',
  'singapore': 'Singapur', 'singapur': 'Singapur', 'sg': 'Singapur',
  'thailand': 'Thailand', 'th': 'Thailand',
  'israel': 'Israel', 'il': 'Israel', 'ישראל': 'Israel',
  'united arab emirates': 'Vereinigte Arabische Emirate', 'uae': 'Vereinigte Arabische Emirate', 'vae': 'Vereinigte Arabische Emirate', 'emirates': 'Vereinigte Arabische Emirate',
};

// ============================================================
// MAIN PARSER FUNCTION
// ============================================================

/**
 * Parse a European address string into structured components with confidence scoring.
 * @param {string} rawAddress - The raw address string (can be multi-line)
 * @returns {Object} Parsed address with name, additionalName, street, addressLine2, zip, city, country, confidence, warnings
 */
export function parseAddress(rawAddress) {
  const result = {
    name: '',
    additionalName: '',
    street: '',
    addressLine2: '',
    zip: '',
    city: '',
    country: 'Deutschland',
    confidence: 0,
    warnings: []
  };

  if (!rawAddress || typeof rawAddress !== 'string') {
    result.warnings.push('Empty or invalid input');
    return result;
  }

  // Split into lines and clean up
  const lines = rawAddress
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    result.warnings.push('No address lines found');
    return result;
  }

  let confidence = 0;
  let countryExplicit = false;
  let zipPatternMatched = null;

  // ============ STEP 1: Detect explicit country (last line) ============
  let countryLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const detected = detectCountry(lines[i]);
    // Only match if line is purely a country name (no mixed content)
    if (detected && lines[i].match(/^[\p{L}\s\-]+$/u) && !looksLikeStreet(lines[i])) {
      result.country = detected;
      countryLineIndex = i;
      countryExplicit = true;
      confidence += 20;
      break;
    }
  }

  // Remove country line if it was standalone
  const workingLines = countryLineIndex >= 0 
    ? lines.filter((_, i) => i !== countryLineIndex)
    : [...lines];

  // ============ STEP 2: Find ZIP + City ============
  let zipCityLineIndex = -1;
  for (let i = workingLines.length - 1; i >= 0; i--) {
    const zipCity = extractZipAndCity(workingLines[i]);
    if (zipCity.zip) {
      result.zip = zipCity.zip;
      result.city = zipCity.city;
      zipCityLineIndex = i;
      zipPatternMatched = zipCity.patternName;
      confidence += 30;
      
      // Infer country from ZIP pattern if not explicitly provided
      if (!countryExplicit && zipCity.inferredCountry) {
        result.country = zipCity.inferredCountry;
        result.warnings.push(`Country inferred from postal code format (${zipCity.patternName})`);
      }
      break;
    }
  }

  if (!result.zip) {
    result.warnings.push('No postal code detected');
  }

  // Remove zip+city line from working set
  const remainingLines = zipCityLineIndex >= 0
    ? workingLines.filter((_, i) => i !== zipCityLineIndex)
    : workingLines;

  // ============ STEP 3: Identify name (first line) ============
  if (remainingLines.length > 0) {
    const firstLine = remainingLines[0];
    // Check if first line looks like a name (2+ words, no numbers usually)
    const wordCount = firstLine.split(/\s+/).filter(w => w.length > 1).length;
    if (wordCount >= 2 && !/\d/.test(firstLine)) {
      confidence += 15;
    }
    result.name = firstLine;
  }

  // ============ STEP 4: Find street line ============
  let streetLineIndex = -1;
  for (let i = 1; i < remainingLines.length; i++) {
    if (looksLikeStreet(remainingLines[i])) {
      result.street = normalizeStreet(remainingLines[i]);
      streetLineIndex = i;
      
      // Check if street suffix is recognized
      if (hasRecognizedStreetSuffix(remainingLines[i])) {
        confidence += 20;
      }
      break;
    }
  }

  // If no obvious street found, use the last remaining line (before zip/city)
  if (streetLineIndex === -1 && remainingLines.length > 1) {
    const lastLine = remainingLines[remainingLines.length - 1];
    if (!isAdditionalLine(lastLine)) {
      result.street = normalizeStreet(lastLine);
      streetLineIndex = remainingLines.length - 1;
    }
  }

  // ============ STEP 5: Categorize remaining lines ============
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
      // Lines before street (company name, etc.) go to additionalName
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

  // ============ STEP 6: Bonus confidence for ZIP+City together ============
  if (result.zip && result.city) {
    confidence += 15;
  }

  // ============ STEP 7: Finalize confidence ============
  result.confidence = Math.min(100, confidence);
  
  // Add warnings for low confidence
  if (result.confidence < 50) {
    if (!result.street) result.warnings.push('No street detected');
    if (!result.name) result.warnings.push('No name detected');
  }

  return result;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Detect country from a string using comprehensive country name map
 */
function detectCountry(text) {
  const normalized = text.trim().toLowerCase();
  return COUNTRY_NAME_MAP[normalized] || null;
}

/**
 * Extract zip code and city from a line, with country inference
 */
function extractZipAndCity(line) {
  const result = { zip: '', city: '', patternName: null, inferredCountry: null };
  
  for (const patternName of ZIP_PATTERN_ORDER) {
    const { pattern, country } = ZIP_PATTERNS[patternName];
    const match = line.match(pattern);
    if (match) {
      result.zip = match[1].toUpperCase().replace(/\s+/g, ' ');
      result.patternName = patternName;
      result.inferredCountry = country;
      
      // Extract city (usually after zip, sometimes before)
      const afterZip = line.substring(line.indexOf(match[0]) + match[0].length).trim();
      const beforeZip = line.substring(0, line.indexOf(match[0])).trim();
      
      result.city = afterZip || beforeZip;
      result.city = result.city.replace(/^[,\s]+|[,\s]+$/g, '');
      break;
    }
  }

  return result;
}

/**
 * Check if a line looks like a street address
 */
function looksLikeStreet(line) {
  // Must contain a number (house number)
  if (!/\d/.test(line)) return false;
  
  // Check for recognized street suffixes
  if (hasRecognizedStreetSuffix(line)) return true;
  
  // Has number pattern typical of addresses
  return STREET_NUMBER_PATTERNS.numberAtEnd.test(line) ||
         STREET_NUMBER_PATTERNS.numberAtStart.test(line) ||
         STREET_NUMBER_PATTERNS.withSlash.test(line) ||
         STREET_NUMBER_PATTERNS.withRange.test(line);
}

/**
 * Check if line contains a recognized street suffix
 */
function hasRecognizedStreetSuffix(line) {
  const lineLower = line.toLowerCase();
  for (const suffix of ALL_STREET_SUFFIXES) {
    // Check as word boundary or at end of word
    const regex = new RegExp(`\\b${suffix.replace('.', '\\.')}\\b|\\.?${suffix.replace('.', '\\.')}\\s|${suffix.replace('.', '\\.')}$`, 'i');
    if (regex.test(lineLower)) return true;
  }
  return false;
}

/**
 * Normalize street format
 */
function normalizeStreet(line) {
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

// ============================================================
// UTILITY EXPORTS
// ============================================================

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
    confidence: 0,
    warnings: []
  };
}

export default {
  parseAddress,
  formatAddress,
  emptyAddress,
};
