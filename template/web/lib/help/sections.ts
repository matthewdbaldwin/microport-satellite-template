// __APP_NAME__ Help Library — section registry. Drives the /help sidebar nav,
// the index page, the role-gated visibility filter, and the HelpButton
// deep-links.
//
// The visibility gate + section derivations live in the shared, unit-tested
// microport-ui ./help/logic module so they can't drift across satellites; only
// this DATA (the topic list + role gates) is app-specific.
//
// SCAFFOLD: one section, one live article. To add a topic: register it here
// (status 'stub' until the article exists), then drop
// content/<slug>.ts (+ .zh/.fr) and register all three in content/index.ts.
// The coverage test (lib/help/coverage.test.ts) fails the build if a 'live'
// item has no content in any locale — that is the guard against the fleet's
// worst help failure, the silently-hidden button (audit P0-5).
//
// status: 'live' — full article in content/<slug>.ts. 'stub' — registered
//         topic, no article yet → shared placeholder.
// roles:  omit for "every signed-in user"; a list restricts to those roles.
import { canSee, visibleLiveSectionsFor } from '@matthewdbaldwin/microport-ui/help/logic';

export interface HelpItem {
  slug: string;
  label: string;
  status: 'live' | 'stub';
  roles?: string[];
  superuserOnly?: boolean;
  /** Route file(s) whose auth gating backs this topic — for future audits. */
  gateRefs?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  items: HelpItem[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    items: [
      { slug: 'getting-started', label: 'Signing in & your role', status: 'live', gateRefs: ['src/routes/auth.js'] },
    ],
  },
];

/** Flat slug set for the dynamic route gate + any audit script. */
export const HELP_SLUGS = new Set(HELP_SECTIONS.flatMap(s => s.items.map(i => i.slug)));

/** Returns the section + item for a given slug, or undefined. */
export function lookupHelpItem(slug: string): { section: HelpSection; item: HelpItem } | undefined {
  for (const section of HELP_SECTIONS) {
    const item = section.items.find(i => i.slug === slug);
    if (item) return { section, item };
  }
  return undefined;
}

/** Minimal user shape for the gate — matches AuthContext's AuthUser. */
export interface HelpGateUser {
  role: string;
  isSuperuser?: boolean;
}

/** True if this user can see the given help item per its role + superuser gates. */
export function canSeeHelpItem(user: HelpGateUser | null | undefined, item: HelpItem): boolean {
  return canSee(user, item);
}

/** Filtered copy of HELP_SECTIONS scoped to the user — only LIVE, visible items;
 *  empty sections drop out. Delegates to the shared derivation. */
export function visibleSectionsFor(user: HelpGateUser | null | undefined): HelpSection[] {
  return visibleLiveSectionsFor(HELP_SECTIONS, user) as HelpSection[];
}
