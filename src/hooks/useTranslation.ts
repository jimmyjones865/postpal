import { t, getLanguage } from '@/lib/i18n';

/**
 * React hook for accessing translations.
 * Provides the `t` function and current language.
 * 
 * @example
 * const { t } = useTranslation();
 * return <h1>{t('app.title')}</h1>;
 */
export function useTranslation() {
  return { 
    t, 
    language: getLanguage() 
  };
}
