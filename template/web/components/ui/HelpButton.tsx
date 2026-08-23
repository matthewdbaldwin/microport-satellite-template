'use client';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { HelpButton as Base, useSidebarSide } from '@matthewdbaldwin/microport-ui';
import type { HelpContent, RoleAwareHelp } from '@matthewdbaldwin/microport-ui';
import { HELP_KEY_TO_SLUG } from '@/lib/help/popoverRoutes';

// __APP_NAME__ wraps the shared lib's HelpButton (mirrors opsport/EngagePort's
// web/components/ui/HelpButton.tsx):
//   1. sidebarSide from context — the scaffold has no SidebarSideProvider yet,
//      so useSidebarSide() returns the lib default ('left'); when the app
//      grows the sidebar-flip chrome this picks the user's side up for free.
//   2. an optional helpKey prop that pulls content from i18n instead of an
//      inline HelpContent object.
//
// Two ways to use it:
//
//   <HelpButton content={HELP} role={user?.role} />     inline HELP constant
//   <HelpButton helpKey="home" role={user?.role} />     content from messages/<locale>.json
//
// When helpKey is set, the wrapper reads `helpContent.<helpKey>` from the
// active locale and builds the RoleAwareHelp object on the fly.
//
// Schema in messages/<locale>.json:
//   "helpContent": {
//     "<helpKey>": {
//       "default": { "summary": "...", "bullets": ["..."] },
//       "admin":   { "summary": "...", "bullets": ["..."] }
//     }
//   }
//
// Role-aware lookup follows the shared lib's rules:
//   content[role] -> content.default -> button hides if neither resolves.
// That silent hide is the fleet's worst help failure (audit P0-5) — the
// coverage test guards every helpKey referenced in HELP_KEY_TO_SLUG /
// POPOVER_ROUTES against the messages files.

interface BaseProps {
  role?: string;
  title?: string;
  inline?: boolean;
  helpHref?: string;
}

type Props =
  | (BaseProps & { content: HelpContent | RoleAwareHelp; helpKey?: never })
  | (BaseProps & { helpKey: string; content?: never });

export function HelpButton(props: Props) {
  const sidebarSide = useSidebarSide();

  if ('content' in props && props.content) {
    return (
      <Base
        content={props.content}
        role={props.role}
        title={props.title}
        inline={props.inline}
        sidebarSide={sidebarSide}
        helpHref={props.helpHref}
      />
    );
  }

  const helpKey = (props as { helpKey: string }).helpKey;

  return (
    <HelpButtonFromKey
      helpKey={helpKey}
      role={props.role}
      title={props.title}
      inline={props.inline}
      helpHref={props.helpHref}
      sidebarSide={sidebarSide}
    />
  );
}

// Split so the useTranslations hook only runs on the i18n branch.
function HelpButtonFromKey({
  helpKey,
  role,
  title,
  inline,
  helpHref,
  sidebarSide,
}: {
  helpKey: string;
  role?: string;
  title?: string;
  inline?: boolean;
  helpHref?: string;
  sidebarSide: 'left' | 'right';
}) {
  // `useTranslations` scopes to the namespace; `t.raw('default')` returns the
  // raw JSON subtree so arrays come through intact.
  const t = useTranslations(`helpContent.${helpKey}`);

  // Deep-link the popover footer to the matching Help Library article when the
  // helpKey maps to one; otherwise fall back to whatever the caller passed (or
  // the shared component's default /help index).
  const resolvedHelpHref = helpHref ?? (HELP_KEY_TO_SLUG[helpKey] ? `/help/${HELP_KEY_TO_SLUG[helpKey]}` : undefined);

  const content = useMemo<RoleAwareHelp>(() => {
    const built: RoleAwareHelp = {};
    const defaultVariant = readVariant(t, 'default');
    if (defaultVariant) built.default = defaultVariant;

    // The app's roles (prisma schema.prisma `enum Role`). Missing roles are
    // skipped silently — the base component falls back to default. Extend this
    // list when the Role enum grows.
    for (const r of KNOWN_ROLES) {
      const v = readVariant(t, r);
      if (v) built[r] = v;
    }
    return built;
  }, [t]);

  return (
    <Base
      content={content}
      role={role}
      title={title}
      inline={inline}
      helpHref={resolvedHelpHref}
      sidebarSide={sidebarSide}
    />
  );
}

const KNOWN_ROLES = [
  '__PRIMARY_ROLE__',
  'admin',
  'superuser',
] as const;

// Defensive reader — probing every role variant is intentional (most keys
// only author `default`), so guard with t.has() FIRST: t.raw() on an absent
// key makes next-intl emit a MISSING_MESSAGE console error even though we
// catch the throw. t.has() is a silent existence check; try/catch stays as a
// backstop.
function readVariant(
  t: ReturnType<typeof useTranslations>,
  key: string,
): HelpContent | undefined {
  if (!t.has(key)) return undefined;
  try {
    const raw = t.raw(key) as unknown;
    if (!raw || typeof raw !== 'object') return undefined;
    const v = raw as Partial<HelpContent>;
    if (typeof v.summary !== 'string' || !Array.isArray(v.bullets)) return undefined;
    return v as HelpContent;
  } catch {
    return undefined;
  }
}

// Re-export types so imports of HelpContent / RoleAwareHelp from this path work.
export type { HelpContent, RoleAwareHelp };
