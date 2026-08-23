'use client';

// /help — index (adapted from EngagePort's web/app/help/page.tsx, the fleet
// reference). A search-first header band over section cards. Typing replaces
// the cards with ranked results; clearing restores them. Only finished (live)
// articles appear (visibleSectionsFor hides stubs).
//
// Search corpus = TWO stores (a fresh mint has no legacy per-role dialog):
// articles (web/lib/help/content) + HelpButton popovers (the app's
// messages/<locale>.json#helpContent namespace, read via next-intl's
// useMessages() — already shipped to the client for the active locale, so
// this costs nothing extra to read). A literal-pass miss (results.length===0)
// triggers a typo-tolerant fuzzy fallback, dynamically imported so fuse.js
// never lands in a non-/help chunk. Fuzzy hits render under a de-emphasized
// "Did you mean…" heading, never intermixed with literal hits — the two
// engines' scores aren't comparable (searchHelpFuzzy's is 0-100 normalized;
// searchHelp's is an unbounded summed field weight).
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Rocket, BookOpen, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { useLocale, useMessages } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { visibleSectionsFor } from '@/lib/help/sections';
import { buildSearchDocs, type PopoverStore } from '@/lib/help/searchDocs';
import { recordHelpSearchMiss } from '@/lib/help/searchMiss';
import { helpUi, helpSectionTitle, helpItemLabel, helpBrowseLead, helpResultCount, helpNoResults } from '@/lib/help/i18n';
import { searchHelp, type HelpSearchResult } from '@matthewdbaldwin/microport-ui/help/logic';
import type { HelpFuzzySearchResult } from '@matthewdbaldwin/microport-ui/help/fuzzy';

// Theme tokens (not fixed hex) so the section cards use the app palette. The
// scaffold ships one section; give each NEW section its own icon + a distinct
// hue token when the registry grows (EngagePort's SECTION_META is the model).
const SECTION_META: Record<string, { icon: LucideIcon; color: string }> = {
  'getting-started': { icon: Rocket, color: 'var(--accent)' },
};
const FALLBACK = { icon: BookOpen, color: 'var(--accent)' };

function resultBadge(kind: HelpSearchResult['kind'], ui: ReturnType<typeof helpUi>): string | null {
  if (kind === 'article') return ui.badgeArticle;
  if (kind === 'popover') return ui.badgePageTip;
  return null; // 'legacy' never occurs — a fresh mint has no legacy store
}

function ResultRow({ r, ui }: { r: HelpSearchResult | HelpFuzzySearchResult; ui: ReturnType<typeof helpUi> }) {
  const href = r.kind === 'popover' ? r.targetHref : `/help/${r.slug}`;
  const badge = resultBadge(r.kind, ui);
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 font-medium" style={{ color: 'var(--text)' }}>
          {r.title}
          {badge && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5"
              style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
            >
              {badge}
            </span>
          )}
        </span>
        {r.sectionTitle && <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{r.sectionTitle}</span>}
      </div>
      {r.snippet && <p className="mt-1 text-sm leading-relaxed line-clamp-2" style={{ color: 'var(--muted)' }}>{r.snippet}</p>}
    </>
  );
  const className = 'block rounded-lg border p-4 transition-colors hover:border-accent';
  const style = { borderColor: 'var(--border)', background: 'var(--surface)' };
  // A popover doc with no resolved targetHref is searchable but not
  // clickable (see POPOVER_ROUTES / the docs agent's popover-route check).
  if (!href) return <div className={className} style={{ ...style, cursor: 'default' }}>{body}</div>;
  return <Link href={href} className={className} style={style}>{body}</Link>;
}

export default function HelpIndexPage() {
  const { user } = useAuth();
  const locale = useLocale();
  const ui = helpUi(locale);
  const messages = useMessages() as Record<string, unknown> | undefined;
  const [query, setQuery] = useState('');
  const sections = useMemo(() => visibleSectionsFor(user), [user]);
  const total = useMemo(() => sections.reduce((n, s) => n + s.items.length, 0), [sections]);
  const docs = useMemo(
    () => buildSearchDocs(locale, (messages?.helpContent ?? undefined) as PopoverStore | undefined),
    [locale, messages],
  );
  const results = useMemo(() => searchHelp(query, docs, user), [query, docs, user]);
  const searching = query.trim().length > 0;

  // Fuzzy fallback — only fires when the literal pass just settled on zero
  // hits for a non-empty query. searchHelpFuzzy is itself async (returns a
  // Promise, per microport-ui's dist/help/fuzzy.d.ts), so the dynamic-import
  // chain must await its result before setting state, not hand the raw
  // Promise to setFuzzyResults.
  const [fuzzyResults, setFuzzyResults] = useState<HelpFuzzySearchResult[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (query.trim() && results.length === 0) {
      import('@matthewdbaldwin/microport-ui/help/fuzzy')
        .then(({ searchHelpFuzzy }) => searchHelpFuzzy(query, docs, user))
        .then((r) => { if (!cancelled) setFuzzyResults(r); })
        .catch(() => { if (!cancelled) setFuzzyResults([]); });
    } else {
      // Synchronous reset when there's nothing to fuzzy-search (empty query
      // or a literal hit already exists) — same shape as EngagePort's /help
      // index, which carries the fleet precedent for this rule.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFuzzyResults([]);
    }
    return () => { cancelled = true; };
  }, [query, results, docs, user]);

  // Miss capture — debounce ~600ms after the query/fuzzy-result state
  // settles; fire only when the literal pass is empty. The effect's own
  // cleanup clears the pending timer on every dependency change, so a rapid
  // typing sequence ("workf"→"workfl"→"workflow") only ever lets the LAST
  // scheduled timer survive to fire — exactly one record, for the final
  // settled query (and, since fuzzyResults is itself a dependency, the fuzzy
  // fetch resolving also resets the timer so wasFuzzyRescued reflects its
  // outcome). recordHelpSearchMiss is a documented no-op in the scaffold —
  // see web/lib/help/searchMiss.ts for what wiring a real sink takes.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const t = setTimeout(() => {
      if (results.length === 0) recordHelpSearchMiss({ query: trimmed, wasFuzzyRescued: fuzzyResults.length > 0, locale });
    }, 600);
    return () => clearTimeout(t);
  }, [query, results, fuzzyResults, locale]);

  return (
    <div className="max-w-5xl space-y-8 py-2">
      <header
        className="rounded-2xl p-6 sm:p-8 border border-border space-y-4"
        style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), color-mix(in srgb, var(--accent) 4%, var(--surface)))' }}
      >
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--text)' }}>{ui.helpLibrary}</h1>
          <p className="max-w-2xl text-base leading-relaxed" style={{ color: 'var(--muted)' }}>{helpBrowseLead(total, locale)}</p>
        </div>
        <div className="relative max-w-xl">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={ui.searchPlaceholder}
            aria-label={ui.searchAria}
            className="w-full rounded-lg border pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
      </header>

      {searching ? (
        <div className="space-y-6">
          {results.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{helpNoResults(query.trim(), locale)}</p>
              {fuzzyResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{ui.didYouMean}</p>
                  <ul className="space-y-2 opacity-80">
                    {fuzzyResults.map(r => (
                      <li key={`fuzzy-${r.slug}`}><ResultRow r={r} ui={ui} /></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{helpResultCount(results.length, locale)}</p>
              <ul className="space-y-2">
                {results.map(r => (
                  <li key={r.slug}><ResultRow r={r} ui={ui} /></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {sections.map(section => {
              const meta = SECTION_META[section.id] ?? FALLBACK;
              const Icon = meta.icon;
              return (
                <section
                  key={section.id}
                  className="rounded-xl border p-5 flex flex-col gap-3"
                  style={{ borderColor: 'var(--border)', background: `color-mix(in srgb, ${meta.color} 4%, var(--surface))` }}
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}>
                      <Icon size={18} />
                    </span>
                    <h2 className="text-base font-semibold flex-1 min-w-0" style={{ color: 'var(--text)' }}>{helpSectionTitle(section.id, section.title, locale)}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--muted) 14%, transparent)', color: 'var(--muted)' }}>{section.items.length}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {section.items.map(item => (
                      <li key={item.slug}>
                        <Link
                          href={`/help/${item.slug}`}
                          className="group flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors hover:bg-[var(--surface2)]"
                          style={{ color: 'var(--text)' }}
                        >
                          <ChevronRight size={14} style={{ color: meta.color }} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                          <span className="min-w-0">{helpItemLabel(item.slug, item.label, locale)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          {sections.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>{ui.noArticles}</p>}
        </>
      )}
    </div>
  );
}
