type Translations = Record<string, string>;

let translations: Translations = {};
let currentLanguage = 'de';

/**
 * Initialize i18n by loading the translation file for the specified language.
 * Falls back to German if the requested language file fails to load.
 */
export async function initI18n(language: string): Promise<void> {
  currentLanguage = language;
  try {
    const response = await fetch(`/locales/${language}.json`);
    if (!response.ok) {
      // Fallback to German
      console.warn(`Failed to load ${language} translations, falling back to German`);
      const fallback = await fetch('/locales/de.json');
      if (fallback.ok) {
        translations = await fallback.json();
      }
    } else {
      translations = await response.json();
    }
  } catch (error) {
    console.error('Failed to load translations:', error);
    translations = {};
  }
}

/**
 * Get a translated string by key with optional parameter substitution.
 * 
 * @param key - The translation key (e.g., 'settings.printer')
 * @param params - Optional parameters for substitution (e.g., { count: 5 })
 * @returns The translated string with parameters replaced
 * 
 * @example
 * t('history.labels', { count: 5 }) // "5 labels"
 * t('toast.insufficientBalanceDesc', { balance: '4.50', cost: '5.00' })
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[key] || key;
  
  if (params) {
    Object.entries(params).forEach(([param, value]) => {
      text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), String(value));
    });
  }
  
  return text;
}

/**
 * Get the currently active language code.
 */
export function getLanguage(): string {
  return currentLanguage;
}
