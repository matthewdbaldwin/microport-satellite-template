// next-intl request config. Resolves the active locale (cookie → default) and
// loads its messages bundle. feedback_locale_provider_table_driven.
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LOCALES, DEFAULT_LOCALE } from '@/components/LocaleProvider';

export default getRequestConfig(async () => {
  const cookieLocale = cookies().get('NEXT_LOCALE')?.value;
  const match = LOCALES.find((l) => l.code === cookieLocale) || LOCALES.find((l) => l.code === DEFAULT_LOCALE)!;
  const messages = (await import(`./messages/${match.file}.json`)).default;
  return { locale: match.code, messages };
});
