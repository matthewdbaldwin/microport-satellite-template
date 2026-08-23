// web/lib/help/i18n.ts — localized CHROME strings for the /help library (sidebar
// nav, index cards, search UI, the renderer's static labels). Article BODIES are
// resolved separately via getHelpContent(slug, locale). Functions take the raw
// locale string from next-intl's useLocale() and fall back to English.
import { getHelpContent } from './content';

type Dict = Record<string, string>;

// Section-group titles, keyed by HELP_SECTIONS id (en mirrors the registry).
const SECTION_TITLES: Record<string, Dict> = {
  en: {
    'getting-started': 'Getting started',
  },
  zh: {
    'getting-started': '入门',
  },
  fr: {
    'getting-started': 'Prise en main',
  },
};

/** Localized section-group title; falls back to the registry's en label. */
export function helpSectionTitle(id: string, fallback: string, locale: string): string {
  return SECTION_TITLES[locale]?.[id] ?? fallback;
}

/** Localized nav label for an article — reuses the translated article `title`
 *  when a localized module exists, else the registry's en label. */
export function helpItemLabel(slug: string, fallback: string, locale: string): string {
  return getHelpContent(slug, locale)?.title ?? fallback;
}

export interface HelpUiStrings {
  help: string;
  openMenu: string;
  helpLibrary: string;
  backTo: string;
  searchPlaceholder: string;
  searchAria: string;
  noArticles: string;
  related: string;
  onThisPage: string;
  lastUpdated: string;
  forRoles: string;
  /** De-emphasized heading over the fuzzy-fallback result list — shown only
   *  when the literal pass returns zero hits. */
  didYouMean: string;
  /** Result-row badge for a kind:'article' hit. */
  badgeArticle: string;
  /** Result-row badge for a kind:'popover' hit (HelpButton content surfaced
   *  in search, deep-linking to the page that popover lives on). */
  badgePageTip: string;
}

export const HELP_UI: Record<string, HelpUiStrings> = {
  en: {
    help: 'Help', openMenu: 'Open menu', helpLibrary: 'Help library', backTo: 'Back to __APP_NAME__',
    searchPlaceholder: 'Search help…', searchAria: 'Search help',
    noArticles: 'No help articles are available for your role yet.',
    related: 'Related', onThisPage: 'On this page', lastUpdated: 'Last updated', forRoles: 'For',
    didYouMean: 'Did you mean…', badgeArticle: 'Article', badgePageTip: 'Page tip',
  },
  zh: {
    help: '帮助', openMenu: '打开菜单', helpLibrary: '帮助中心', backTo: '返回 __APP_NAME__',
    searchPlaceholder: '搜索帮助…', searchAria: '搜索帮助',
    noArticles: '暂无适用于您角色的帮助文章。',
    related: '相关', onThisPage: '本页内容', lastUpdated: '最近更新', forRoles: '适用于',
    didYouMean: '您的意思是…', badgeArticle: '文章', badgePageTip: '页面提示',
  },
  fr: {
    help: 'Aide', openMenu: 'Ouvrir le menu', helpLibrary: "Centre d'aide", backTo: 'Retour à __APP_NAME__',
    searchPlaceholder: "Rechercher dans l'aide…", searchAria: "Rechercher dans l'aide",
    noArticles: "Aucun article d'aide n'est disponible pour votre rôle pour l'instant.",
    related: 'Articles liés', onThisPage: 'Sur cette page', lastUpdated: 'Dernière mise à jour', forRoles: 'Pour',
    didYouMean: 'Vous vouliez dire…', badgeArticle: 'Article', badgePageTip: 'Astuce',
  },
};

export function helpUi(locale: string): HelpUiStrings {
  return HELP_UI[locale] ?? HELP_UI.en;
}

/** The renderer-chrome strings, shaped for HelpArticleView's `strings` prop. */
export function helpViewStrings(locale: string) {
  const u = helpUi(locale);
  return { help: u.help, related: u.related, onThisPage: u.onThisPage, lastUpdated: u.lastUpdated, forRoles: u.forRoles };
}

/** "Browse N articles scoped to your role — or search by what you're trying to do." */
export function helpBrowseLead(n: number, locale: string): string {
  switch (locale) {
    case 'zh': return `浏览 ${n} 篇与您角色相关的文章——或按您想完成的任务搜索。`;
    case 'fr': return `Parcourez ${n} article${n === 1 ? '' : 's'} adapté${n === 1 ? '' : 's'} à votre rôle — ou recherchez selon ce que vous souhaitez faire.`;
    default:   return `Browse ${n} ${n === 1 ? 'article' : 'articles'} scoped to your role — or search by what you’re trying to do.`;
  }
}

/** Search results count, with locale plural. */
export function helpResultCount(n: number, locale: string): string {
  switch (locale) {
    case 'zh': return `${n} 条结果`;
    case 'fr': return `${n} résultat${n === 1 ? '' : 's'}`;
    default:   return `${n} ${n === 1 ? 'result' : 'results'}`;
  }
}

/** Empty-search-result message. */
export function helpNoResults(query: string, locale: string): string {
  switch (locale) {
    case 'zh': return `没有与“${query}”匹配的结果。`;
    case 'fr': return `Aucun résultat pour « ${query} ».`;
    default:   return `No results for “${query}”.`;
  }
}
