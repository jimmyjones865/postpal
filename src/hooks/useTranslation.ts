import { t } from '@/lib/i18n';

/**
 * React hook for accessing translations.
 *
 * @example
 * const { t } = useTranslation();
 * return <h1>{t('app.title')}</h1>;
 */
export function useTranslation() {
  return { t };
}
