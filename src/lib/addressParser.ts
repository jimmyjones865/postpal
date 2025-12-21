// Parse a freeform address into structured fields
// Expected format (5 lines max):
// Line 1: Name (first + last name)
// Line 2: Optional - additionalName (company, c/o) OR goes to addressLine2
// Line 3: Street + house number
// Line 4: Optional - addressLine2 (apartment, floor) if line 2 was additionalName
// Line 5: ZIP City
// Line 6: Country (optional, defaults to Deutschland)

export interface ParsedAddress {
  name: string;           // First & last name
  additionalName: string; // Optional: company name, c/o, etc. (between name and street)
  street: string;         // Street & house number
  addressLine2: string;   // Optional: apartment, floor, etc. (between street and zip)
  zip: string;            // Postal code
  city: string;           // City name
  country: string;        // Country
}

// Pattern to detect ZIP code line (German: 5 digits, International: various)
const ZIP_CITY_PATTERN = /^(\d{4,6})\s+(.+)$/;

// Pattern to detect street with house number
const STREET_PATTERN = /^.+\s+\d+[a-zA-Z]?(\s*[-–\/]\s*\d+[a-zA-Z]?)?$/;

// Common additional name indicators
const ADDITIONAL_NAME_INDICATORS = ['c/o', 'c.o.', 'z.hd.', 'z. hd.', 'attn', 'attn:', 'bei', 'firma', 'gmbh', 'ag', 'kg', 'ohg', 'ug', 'e.v.', 'e.k.'];

function isLikelyAdditionalName(line: string): boolean {
  const lower = line.toLowerCase();
  return ADDITIONAL_NAME_INDICATORS.some(indicator => lower.includes(indicator));
}

function isLikelyStreet(line: string): boolean {
  return STREET_PATTERN.test(line.trim());
}

function isLikelyZipCity(line: string): boolean {
  return ZIP_CITY_PATTERN.test(line.trim());
}

export function parseAddress(rawAddress: string): ParsedAddress {
  const lines = rawAddress
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const result: ParsedAddress = {
    name: '',
    additionalName: '',
    street: '',
    addressLine2: '',
    zip: '',
    city: '',
    country: 'Deutschland',
  };

  if (lines.length === 0) return result;

  // Find the ZIP+City line first (most reliable anchor)
  let zipCityIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isLikelyZipCity(lines[i])) {
      zipCityIndex = i;
      break;
    }
  }

  // If we found ZIP+City, check if there's a country after it
  let countryIndex = -1;
  if (zipCityIndex !== -1 && zipCityIndex < lines.length - 1) {
    // Last line is likely country
    countryIndex = lines.length - 1;
    result.country = lines[countryIndex];
  }

  // Parse ZIP and City
  if (zipCityIndex !== -1) {
    const match = lines[zipCityIndex].match(ZIP_CITY_PATTERN);
    if (match) {
      result.zip = match[1];
      result.city = match[2];
    }
  }

  // First line is always the name
  if (lines.length > 0) {
    result.name = lines[0];
  }

  // Now figure out what's between name and ZIP+City
  const startIndex = 1;
  const endIndex = zipCityIndex !== -1 ? zipCityIndex : (countryIndex !== -1 ? countryIndex : lines.length);

  const middleLines = lines.slice(startIndex, endIndex);

  if (middleLines.length === 1) {
    // Only one line between name and zip - it's the street
    result.street = middleLines[0];
  } else if (middleLines.length === 2) {
    // Two lines - need to figure out which is additionalName vs addressLine2
    if (isLikelyStreet(middleLines[0])) {
      // First is street, second is addressLine2
      result.street = middleLines[0];
      result.addressLine2 = middleLines[1];
    } else if (isLikelyStreet(middleLines[1])) {
      // First is additionalName, second is street
      result.additionalName = middleLines[0];
      result.street = middleLines[1];
    } else if (isLikelyAdditionalName(middleLines[0])) {
      // First looks like company/c/o, second is street
      result.additionalName = middleLines[0];
      result.street = middleLines[1];
    } else {
      // Default: first is additional name, second is street
      result.additionalName = middleLines[0];
      result.street = middleLines[1];
    }
  } else if (middleLines.length >= 3) {
    // Three or more lines
    result.additionalName = middleLines[0];
    result.street = middleLines[1];
    result.addressLine2 = middleLines.slice(2).join(', ');
  }

  // If we didn't find ZIP+City with the pattern, try to use remaining lines
  if (zipCityIndex === -1 && lines.length > 1) {
    // Use last non-country line as ZIP+City
    const lastLineIndex = countryIndex !== -1 ? countryIndex - 1 : lines.length - 1;
    if (lastLineIndex > 0) {
      const lastLine = lines[lastLineIndex];
      const match = lastLine.match(ZIP_CITY_PATTERN);
      if (match) {
        result.zip = match[1];
        result.city = match[2];
      } else {
        // Just put the whole line as city
        result.city = lastLine;
      }
    }
  }

  return result;
}

export function formatParsedAddress(parsed: ParsedAddress): string {
  const lines: string[] = [];
  
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
