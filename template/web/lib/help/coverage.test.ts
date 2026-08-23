// Help Library coverage guard — the anti-P0-5 test.
//
// The fleet's worst help failure mode is SILENT: a helpKey with no resolvable
// content makes the shared HelpButton render nothing (no error, no button),
// and a 'live' registry item with no article module falls back to the stub
// placeholder without anyone noticing. Both failures are invisible in the UI
// and only show up as "where did the help go?" reports (audit P0-5). This
// test turns them into red CI instead.
//
// Three contracts:
//   1. Registry ↔ articles: every 'live' HELP_SECTIONS item has a content
//      module in EVERY locale (strict per-locale lookup via
//      HELP_CONTENT_BY_LOCALE — getHelpContent's en-fallback would mask a
//      missing translation), and every content module is reachable from the
//      registry.
//   2. Deep links: every HELP_KEY_TO_SLUG target is a registered slug.
//   3. Popovers: every helpKey referenced by POPOVER_ROUTES or
//      HELP_KEY_TO_SLUG has helpContent.<key>.default.summary + bullets in
//      ALL THREE messages files (the shared HelpButton hides itself when the
//      role variant AND default both miss — default is the floor).
import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS, HELP_SLUGS } from './sections';
import { HELP_CONTENT_BY_LOCALE, HELP_CONTENT_SLUGS } from './content';
import { POPOVER_ROUTES, HELP_KEY_TO_SLUG } from './popoverRoutes';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import fr from '../../messages/fr.json';

const LOCALES = ['en', 'zh', 'fr'] as const;
const MESSAGES: Record<(typeof LOCALES)[number], Record<string, unknown>> = { en, zh, fr };

const liveSlugs = HELP_SECTIONS.flatMap(s => s.items.filter(i => i.status === 'live').map(i => i.slug));

describe('help registry ↔ content parity', () => {
  it.each(LOCALES)('every live item has a %s content module', (locale) => {
    const missing = liveSlugs.filter(slug => !HELP_CONTENT_BY_LOCALE[locale][slug]);
    expect(missing, `live slugs with no ${locale} article — add content/<slug>${locale === 'en' ? '' : `.${locale}`}.ts and register it in content/index.ts`).toEqual([]);
  });

  it('every content module is registered in HELP_SECTIONS', () => {
    const orphans = HELP_CONTENT_SLUGS.filter(slug => !HELP_SLUGS.has(slug));
    expect(orphans, 'article modules unreachable from the registry — add the slug to sections.ts').toEqual([]);
  });

  it('every locale registers the same slug set as en', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(HELP_CONTENT_BY_LOCALE[locale]).sort()).toEqual(HELP_CONTENT_SLUGS.slice().sort());
    }
  });
});

describe('help deep links', () => {
  it('every HELP_KEY_TO_SLUG target is a registered slug', () => {
    const dangling = Object.entries(HELP_KEY_TO_SLUG).filter(([, slug]) => !HELP_SLUGS.has(slug));
    expect(dangling, 'helpKey → slug mappings pointing at unregistered slugs').toEqual([]);
  });
});

describe('popover helpKey coverage in messages', () => {
  const helpKeys = [...new Set([...Object.keys(POPOVER_ROUTES), ...Object.keys(HELP_KEY_TO_SLUG)])];

  it.each(LOCALES)('every helpKey has a default variant in %s', (locale) => {
    const store = MESSAGES[locale].helpContent as
      | Record<string, { default?: { summary?: unknown; bullets?: unknown } }>
      | undefined;
    expect(store, `messages/${locale}.json has no helpContent namespace`).toBeDefined();
    const broken = helpKeys.filter(key => {
      const d = store?.[key]?.default;
      return typeof d?.summary !== 'string' || !Array.isArray(d?.bullets);
    });
    expect(broken, `helpKeys missing helpContent.<key>.default.{summary,bullets[]} in messages/${locale}.json — the button silently hides`).toEqual([]);
  });
});
