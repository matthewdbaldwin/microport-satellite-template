'use client';

// /help — layout for the full __APP_NAME__ help library (adapted from
// EngagePort's web/app/help/layout.tsx, the fleet reference). Signed-in users
// only; pre-auth visitors get redirected to /login with a returnTo set.
//
// Two-column shell: left sidebar nav (topics grouped by section, role-gated),
// right = the active article (rendered by the child page). On mobile the
// sidebar collapses into a Menu button. The ⌘K palette is mounted here,
// scoped to /help.
//
// This is a full-screen shell. The scaffold has no AppShell chrome yet; when
// the app grows one, add /help to its bare-prefix list (EngagePort's
// BARE_PREFIXES pattern) so the app sidebar steps aside and the help library
// owns the viewport. The back link returns to the home page. Locale comes
// from next-intl's useLocale().
import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale, useMessages } from 'next-intl';
import Link from 'next/link';
import { Menu, ArrowLeft } from 'lucide-react';
import { HelpCommandPalette } from '@matthewdbaldwin/microport-ui/help';
import { Tooltip } from '@matthewdbaldwin/microport-ui';
import { useAuth } from '@/contexts/AuthContext';
import { canSeeHelpItem, lookupHelpItem, visibleSectionsFor } from '@/lib/help/sections';
import { buildSearchDocs, type PopoverStore } from '@/lib/help/searchDocs';
import { helpUi, helpSectionTitle, helpItemLabel } from '@/lib/help/i18n';

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const ui = helpUi(locale);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth gate — unauth visitors go to /login with returnTo.
  useEffect(() => {
    if (!loading && !user) router.push(`/login?returnTo=${encodeURIComponent(pathname || '/help')}`);
  }, [user, loading, router, pathname]);

  // Role gate — if the active slug isn't visible to this user, bounce to the index.
  const activeSlug = pathname?.replace(/^\/help\/?/, '').split('/')[0] || '';
  useEffect(() => {
    if (!user || !activeSlug) return;
    const entry = lookupHelpItem(activeSlug);
    if (entry && !canSeeHelpItem(user, entry.item)) router.replace('/help');
  }, [user, activeSlug, router]);

  const visibleSections = useMemo(() => visibleSectionsFor(user), [user]);
  const messages = useMessages() as Record<string, unknown> | undefined;
  const searchDocs = useMemo(
    () => buildSearchDocs(locale, (messages?.helpContent ?? undefined) as PopoverStore | undefined),
    [locale, messages],
  );

  if (loading) {
    return (
      <div className="min-h-screen min-h-dvh flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex min-h-screen min-h-dvh" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* ⌘K / Ctrl-K search palette — scoped to /help */}
      <HelpCommandPalette user={user} docs={searchDocs} onNavigate={slug => router.push(`/help/${slug}`)} />

      {/* Sidebar nav */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r overflow-y-auto transition-transform md:relative md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <Link href="/" className="inline-flex items-center gap-2 text-sm transition-colors hover:opacity-70" style={{ color: 'var(--muted)' }}>
            <ArrowLeft size={14} />
            {ui.backTo}
          </Link>
          <h1 className="text-lg font-semibold mt-3" style={{ color: 'var(--text)' }}>{ui.helpLibrary}</h1>
        </div>

        <nav className="p-3 space-y-6">
          {visibleSections.map(section => (
            <div key={section.id}>
              <div className="text-xs font-semibold uppercase tracking-wider px-2 mb-1.5" style={{ color: 'var(--muted)' }}>
                {helpSectionTitle(section.id, section.title, locale)}
              </div>
              <ul className="space-y-0.5">
                {section.items.map(item => {
                  const isActive = item.slug === activeSlug;
                  return (
                    <li key={item.slug}>
                      <Link
                        href={`/help/${item.slug}`}
                        onClick={() => setMobileOpen(false)}
                        className="block px-2 py-1.5 text-sm rounded transition-colors"
                        style={{
                          background: isActive ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                          color: isActive ? 'var(--accent)' : 'var(--text)',
                        }}
                      >
                        {helpItemLabel(item.slug, item.label, locale)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile sidebar backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden bg-overlay" onClick={() => setMobileOpen(false)} />
      )}

      {/* Article content */}
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <Tooltip content={ui.openMenu} placement="bottom">
            {/* Ghost button inline — the scaffold's globals.css only defines
                .btn-primary; add a .btn-ghost utility if this pattern spreads. */}
            <button
              onClick={() => setMobileOpen(true)}
              aria-label={ui.openMenu}
              className="inline-flex items-center justify-center min-w-11 min-h-11 p-2 rounded-lg transition-colors hover:bg-[var(--surface2)]"
              style={{ color: 'var(--text)', background: 'transparent', border: 'none' }}
            >
              <Menu size={20} />
            </button>
          </Tooltip>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{ui.help}</h1>
        </header>

        <main className="px-4 md:px-10 lg:px-16 py-6 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
