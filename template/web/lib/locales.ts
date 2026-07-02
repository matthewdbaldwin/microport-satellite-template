// Server-safe locale table — NO 'use client'. The next-intl request config
// (web/i18n.ts) runs on the server graph; importing LOCALES from the
// 'use client' LocaleProvider turned it into a client-reference proxy at SSR
// (`LOCALES.find is not a function`). Keep the table here so both the server
// (i18n.ts) and the client (LocaleProvider) import the real array.
// feedback_locale_provider_table_driven, feedback_theme_ts_must_stay_server_safe.

// Table-driven locales — a 4th locale is one row here + one messages/<x>.json.
export const LOCALES = [
  { code: 'en-US', label: 'English', file: 'en' },
  { code: 'zh-CN', label: '中文',     file: 'zh' },
  { code: 'fr-FR', label: 'Français', file: 'fr' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];
export const DEFAULT_LOCALE: LocaleCode = 'en-US';
