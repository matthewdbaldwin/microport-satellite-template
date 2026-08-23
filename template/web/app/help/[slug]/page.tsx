// Dynamic /help/<slug>.
//   - slug has a structured content module → render via HelpArticleClient
//   - slug is a registered stub (or a live slug whose module is missing —
//     defensive) → render the shared placeholder
//   - slug not in HELP_SECTIONS at all → notFound()
import { notFound } from 'next/navigation';
import { lookupHelpItem } from '@/lib/help/sections';
import { getHelpContent } from '@/lib/help/content';
import { HelpStubClient } from '@/components/help/HelpStubClient';
import { HelpArticleClient } from '@/components/help/HelpArticleClient';

interface PageProps { params: Promise<{ slug: string }>; }

export default async function HelpDynamicPage({ params }: PageProps) {
  const { slug } = await params;
  const entry = lookupHelpItem(slug);
  if (!entry) notFound();

  // Resolve in en to decide article-vs-stub; HelpArticleClient re-resolves in
  // the reader's active locale (English fallback).
  const content = getHelpContent(slug);
  if (content) return <HelpArticleClient slug={slug} />;

  return <HelpStubClient label={entry.item.label} sectionTitle={entry.section.title} />;
}
