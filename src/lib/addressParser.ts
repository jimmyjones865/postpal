// Address types and formatting utilities
// Parsing is done server-side via libpostal

export interface ParsedAddress {
  name: string;           // First & last name
  additionalName: string; // Optional: company name, c/o, etc. (between name and street)
  street: string;         // Street & house number
  addressLine2: string;   // Optional: apartment, floor, etc. (between street and zip)
  zip: string;            // Postal code
  city: string;           // City name
  country: string;        // Country
}

export function emptyAddress(): ParsedAddress {
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
