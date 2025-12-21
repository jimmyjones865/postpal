// Address validation for Deutsche Post requirements
// Max 50 chars per line, German alphabet + specific special characters only

// Allowed characters: German alphanumeric + , . - & / ( ) ` +
// German alphabet includes: a-z A-Z äöüß ÄÖÜ 0-9
const ALLOWED_PATTERN = /^[a-zA-ZäöüßÄÖÜ0-9\s,.\-&/()`+]*$/;

// Characters that are explicitly NOT allowed (examples for user feedback)
const FORBIDDEN_EXAMPLES = ['ñ', 'ç', 'ø', 'æ', 'ł', 'ő', 'ű', 'ă', 'ș', 'ț', 'đ', 'ř', 'ě', 'ů', 'ý', 'ã', 'õ', 'ñ', '@', '#', '$', '%', '^', '*', '=', '[', ']', '{', '}', '|', '\\', ':', ';', '"', "'", '<', '>', '?', '!', '~'];

export const MAX_LINE_LENGTH = 50;

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

function findInvalidCharacters(text: string): string[] {
  const invalid: string[] = [];
  for (const char of text) {
    if (!ALLOWED_PATTERN.test(char) && !invalid.includes(char)) {
      invalid.push(char);
    }
  }
  return invalid;
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
    if (trimmedLine && !ALLOWED_PATTERN.test(trimmedLine)) {
      const invalidChars = findInvalidCharacters(trimmedLine);
      errors.push({
        type: 'invalid_characters',
        lineNumber,
        line: trimmedLine,
        details: `Line ${lineNumber} contains invalid characters: ${invalidChars.map(c => `"${c}"`).join(', ')}`,
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
