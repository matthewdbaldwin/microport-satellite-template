'use client';

// Table-driven locales — a 4th locale is one row here + one messages/<x>.json.
// feedback_locale_provider_table_driven, project_i18n_coverage_state.
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';

export const LOCALES = [
  { code: 'en-US', label: 'English', file: 'en' },
  { code: 'zh-CN', label: '中文',     file: 'zh' },
  { code: 'fr-FR', label: 'Français', file: 'fr' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];
export const DEFAULT_LOCALE: LocaleCode = 'en-US';

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
