'use client';
import { useTranslations } from 'next-intl';
import { createHelpButton, fromMap } from '@matthewdbaldwin/microport-ui';
import { HELP_KEY_TO_SLUG } from '@/lib/help/popoverRoutes';
import { HELP_SLUGS } from '@/lib/help/sections';

// __APP_NAME__'s HelpButton. The shared lib owns the behaviour (sidebarSide
// from context, the helpKey -> i18n lookup, the /help deep link); this file is
// just the app's DATA.
//
// Two ways to use it:
//
//   <HelpButton content={HELP} role={user?.role} />     inline HELP constant
//   <HelpButton helpKey="home" role={user?.role} />     content from messages/<locale>.json
//
// Schema in messages/<locale>.json:
//   "helpContent": {
//     "<helpKey>": {
//       "default": { "summary": "...", "bullets": ["..."] },
//       "admin":   { "summary": "...", "bullets": ["..."] }
//     }
//   }
//
// Role-aware lookup: content[role] -> content.default -> button hides if
// neither resolves. That silent hide is the fleet's worst help failure (audit
// P0-5) — lib/help/coverage.test.ts guards every helpKey referenced in
// HELP_KEY_TO_SLUG / POPOVER_ROUTES against the messages files.
export const HelpButton = createHelpButton({
  useTranslations,
  // The app's roles (prisma schema.prisma `enum Role`). Missing roles are
  // skipped silently — the base component falls back to `default`. Extend this
  // list when the Role enum grows.
  roles: ['__PRIMARY_ROLE__', 'admin', 'superuser'],
  // HELP_SLUGS is the registered-article set: a stale HELP_KEY_TO_SLUG entry
  // degrades to the /help index instead of deep-linking to a 404.
  resolveSlug: fromMap(HELP_KEY_TO_SLUG, HELP_SLUGS),
});
