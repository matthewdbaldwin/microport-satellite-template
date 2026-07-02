'use client';

// The locale table lives in the server-safe @/lib/locales (no 'use client') so
// the next-intl server config (i18n.ts) can import it without the client-
// reference-proxy trap (`LOCALES.find is not a function` at SSR). Re-exported
// here for back-compat with existing imports.
// feedback_locale_provider_table_driven, project_i18n_coverage_state.
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { LOCALES, DEFAULT_LOCALE, type LocaleCode } from '@/lib/locales';

export { LOCALES, DEFAULT_LOCALE };
export type { LocaleCode };

export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
