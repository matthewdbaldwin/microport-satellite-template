// __APP_NAME__ Help Library — content registry (slug → typed article module).
//
// Locale-aware: each article has an en module plus sibling `<slug>.zh.ts` /
// `<slug>.fr.ts` translations. getHelpContent(slug, locale) returns the
// localized module, falling back to en when a translation is absent (so a
// partly-translated library always renders).
//
// To add an article: drop content/<slug>.ts (+ .zh/.fr), register all three
// variants below, and add the slug to sections.ts. The coverage test
// (lib/help/coverage.test.ts) enforces registry↔content parity per locale.
import type { HelpArticleContent } from './types';

// — English (canonical) —
import gettingStarted from './getting-started';

// — 中文 —
import gettingStartedZh from './getting-started.zh';

// — Français —
import gettingStartedFr from './getting-started.fr';

type Locale = 'en' | 'zh' | 'fr';

const EN: Record<string, HelpArticleContent> = {
  'getting-started': gettingStarted,
};

const ZH: Record<string, HelpArticleContent> = {
  'getting-started': gettingStartedZh,
};

const FR: Record<string, HelpArticleContent> = {
  'getting-started': gettingStartedFr,
};

/** Exposed for the coverage test (per-locale strict lookup — getHelpContent
 *  falls back to en, which would mask a missing translation). */
export const HELP_CONTENT_BY_LOCALE: Record<Locale, Record<string, HelpArticleContent>> = {
  en: EN, zh: ZH, fr: FR,
};

export const HELP_CONTENT_SLUGS = Object.keys(EN);

export function getHelpContent(slug: string, locale: string = 'en'): HelpArticleContent | undefined {
  return HELP_CONTENT_BY_LOCALE[locale as Locale]?.[slug] ?? EN[slug];
}
