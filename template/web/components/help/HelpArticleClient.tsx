'use client';

// web/components/help/HelpArticleClient.tsx
// __APP_NAME__ adapter for the shared HelpArticleView (microport-ui ./help).
// The per-satellite glue (auth + locale + content resolution + null guard +
// render) lives behind createHelpArticleClient; this file just supplies the
// app's ports — the registry, the auth/locale hooks, the content/strings
// getters, and the router-aware link. getHelpContent re-resolves in the active
// locale, falling back to English.
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { HELP_SECTIONS } from '@/lib/help/sections';
import { getHelpContent } from '@/lib/help/content';
import { helpViewStrings } from '@/lib/help/i18n';
import { createHelpArticleClient } from '@matthewdbaldwin/microport-ui/help';

export const HelpArticleClient = createHelpArticleClient({
  useUser: () => useAuth().user,
  useLocale: () => useLocale(),
  getContent: (slug, locale) => getHelpContent(slug, locale) ?? null,
  getStrings: (locale) => helpViewStrings(locale),
  sections: HELP_SECTIONS,
  linkComponent: Link,
});
