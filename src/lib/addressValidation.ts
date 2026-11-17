// Deutsche Post line length + charset rules. Characters the server sanitizes away (ł → l, ń → n, …) are not errors.
import { invalidChars, MAX_LINE_LENGTH } from '../../server/lib/address-rules.js';

export { MAX_LINE_LENGTH };

export interface AddressValidationError {
  type: 'line_too_long' | 'invalid_characters';
  lineNumber: number;
  line: string;
  details: string;
}

export interface AddressValidationResult {
  isValid: boolean;
  errors: AddressValidationError[];
}

export function validateAddress(address: string): AddressValidationResult {
  const errors: AddressValidationError[] = [];
  const lines = address.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmedLine = line.trim();

    // Check line length
    if (trimmedLine.length > MAX_LINE_LENGTH) {
      errors.push({
        type: 'line_too_long',
        lineNumber,
        line: trimmedLine,
        details: `Line ${lineNumber} has ${trimmedLine.length} characters (max ${MAX_LINE_LENGTH})`,
      });
    }

    // Check for invalid characters
    const badChars = trimmedLine ? invalidChars(trimmedLine) : [];
    if (badChars.length) {
      errors.push({
        type: 'invalid_characters',
        lineNumber,
        line: trimmedLine,
        details: `Line ${lineNumber} contains invalid characters: ${badChars.map(c => `"${c}"`).join(', ')}`,
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function getValidationSummary(result: AddressValidationResult): string {
  if (result.isValid) return '';
  
  const lineLengthErrors = result.errors.filter(e => e.type === 'line_too_long');
  const charErrors = result.errors.filter(e => e.type === 'invalid_characters');
  
  const messages: string[] = [];
  
  if (lineLengthErrors.length > 0) {
    messages.push(`${lineLengthErrors.length} line(s) exceed ${MAX_LINE_LENGTH} characters`);
  }
  
  if (charErrors.length > 0) {
    messages.push(`${charErrors.length} line(s) contain invalid characters`);
  }
  
  return messages.join('. ');
}
