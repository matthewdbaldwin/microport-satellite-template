'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { HelpButton } from '@/components/ui/HelpButton';

export default function HomePage() {
  const router = useRouter();
  const t = useTranslations('home');
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) return null;

  return (
    <main className="min-h-screen min-h-dvh p-8">
      {/* Page title lives in the TopBar pattern — no body h1. feedback_topbar_page_h1_standard. */}
      <p className="flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
        {t('welcome', { name: user.name || user.email })}
        {/* Every screen wires a HelpButton (docs-agent coverage rule). Content
            comes from messages/<locale>.json#helpContent.home; the footer
            deep-links to /help via HELP_KEY_TO_SLUG. */}
        <HelpButton helpKey="home" role={user.role} inline />
      </p>
      {/* SCAFFOLD: the platform's real home goes here. */}
    </main>
  );
}
