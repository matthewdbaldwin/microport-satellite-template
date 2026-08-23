// __APP_NAME__ glue: flatten the app's help content stores into the plain
// HelpSearchDoc[] the shared search engine (searchHelp / searchHelpFuzzy)
// consumes (title, section name, headings, UI labels, body text).
//
// The scaffold has TWO of the fleet's three help content stores — articles
// (web/lib/help/content, kind:'article') and HelpButton popovers (the
// messages/<locale>.json#helpContent namespace HelpButton.tsx already reads,
// kind:'popover'). There is no legacy per-role dialog store in a fresh mint,
// so no third pass. Recomputed once per index/palette mount.
import { HELP_CONTENT_SLUGS, getHelpContent } from './content';
import { lookupHelpItem } from './sections';
import { helpSectionTitle } from './i18n';
import { POPOVER_ROUTES } from './popoverRoutes';
import type { HelpBlock, HelpSearchDoc } from '@matthewdbaldwin/microport-ui/help/logic';

function walk(blocks: HelpBlock[], body: string[], labels: string[]): void {
  for (const b of blocks) {
    if (b.kind === 'paragraph') { body.push(b.text); if (b.labels) labels.push(...b.labels); }
    else if (b.kind === 'list')  { body.push(...b.items); if (b.labels) labels.push(...b.labels); }
    else if (b.kind === 'steps') { body.push(...b.steps); if (b.labels) labels.push(...b.labels); }
    else if (b.kind === 'faq')   { b.items.forEach(qa => body.push(qa.q, qa.a)); if (b.labels) labels.push(...b.labels); }
    else if (b.kind === 'roleBlock') { walk(b.blocks, body, labels); }
  }
}

type PopoverVariant = { summary?: string; bullets?: string[] };
export type PopoverStore = Record<string, { default?: PopoverVariant } & Record<string, PopoverVariant>>;

export function buildSearchDocs(locale: string = 'en', popoverStore?: PopoverStore): HelpSearchDoc[] {
  const docs: HelpSearchDoc[] = [];
  // 1. Articles
  for (const slug of HELP_CONTENT_SLUGS) {
    const content = getHelpContent(slug, locale);
    if (!content) continue;
    const entry = lookupHelpItem(slug);
    const body: string[] = [content.intro];
    const labels: string[] = [];
    for (const section of content.sections) walk(section.blocks, body, labels);
    docs.push({
      slug,
      kind:          'article',
      title:         content.title,
      sectionTitle:  entry ? helpSectionTitle(entry.section.id, entry.section.title, locale) : '',
      headings:      content.sections.map(s => s.heading),
      labels,
      body:          body.join(' '),
      roles:         entry?.item.roles,
      superuserOnly: entry?.item.superuserOnly,
    });
  }
  // 2. Popovers — default variant only (role variants deliberately unindexed).
  if (popoverStore) {
    for (const [helpKey, variants] of Object.entries(popoverStore)) {
      const d = variants.default;
      if (!d?.summary) continue;
      docs.push({
        slug:         `popover:${helpKey}`,
        kind:         'popover',
        title:        d.summary,
        sectionTitle: '',
        body:         [d.summary, ...(d.bullets ?? [])].join(' '),
        targetHref:   POPOVER_ROUTES[helpKey],   // undefined => searchable, not clickable
      });
    }
  }
  return docs;
}
