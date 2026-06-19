'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';

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
      <p style={{ color: 'var(--muted)' }}>{t('welcome', { name: user.name || user.email })}</p>
      {/* SCAFFOLD: the platform's real home goes here. */}
    </main>
  );
}
