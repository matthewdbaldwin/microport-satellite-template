'use client';

// __APP_NAME__ sign-in — SSO only via SalesPort.
//
// LOOP GUARD (feedback_sso_callback_loop_trap): without a guard, the page
// auto-redirects to SSO whenever there's no user — so a denied role or a lost
// session loops forever (login → SSO → callback denies → /login → …). Two
// independent brakes stop that:
//   1. ?sso_err=<code> — the SSO callback redirects here with it on an
//      access-deny; we render a dead-end instead of redirecting.
//   2. a sessionStorage attempt counter — even if the error signal is lost
//      (callback → home → /auth/me 401 → /login with no query), >N redirects
//      inside a short window trips the brake.
// The manual "Try again" clears the counter and re-enters SSO once.

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';

const SSO_HREF = '/api/auth/sso/start';
const LOOP_KEY = '__APP_SLUG___sso_attempts';
const LOOP_WINDOW_MS = 12_000;
const LOOP_MAX = 2; // a 3rd redirect inside the window is a loop

function tripsLoop(): boolean {
  try {
    const now = Date.now();
    const hist: number[] = JSON.parse(sessionStorage.getItem(LOOP_KEY) || '[]');
    const recent = hist.filter((t) => now - t < LOOP_WINDOW_MS);
    recent.push(now);
    sessionStorage.setItem(LOOP_KEY, JSON.stringify(recent));
    return recent.length > LOOP_MAX;
  } catch {
    return false;
  }
}
function clearLoop() {
  try { sessionStorage.removeItem(LOOP_KEY); } catch { /* ignore */ }
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('auth');
  const { user, loading } = useAuth();
  const ssoErr = params.get('sso_err');
  const [blocked, setBlocked] = useState<string | null>(ssoErr);

  useEffect(() => {
    if (loading) return;
    if (user) { clearLoop(); router.replace('/'); return; }
    if (ssoErr) { setBlocked(ssoErr); return; }        // explicit deny → dead-end
    if (tripsLoop()) { setBlocked('loop'); return; }   // runaway → dead-end
    window.location.href = SSO_HREF;
  }, [loading, user, ssoErr, router]);

  if (loading || user) return null;

  if (blocked) {
    const msg = blocked === 'no_role' ? t('noAccess') : t('signInFailed');
    return (
      <main className="min-h-screen min-h-dvh flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--fg)' }}>__APP_NAME__</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{msg}</p>
          <button
            type="button"
            className="btn-primary w-full justify-center py-2.5 min-h-11"
            onClick={() => { clearLoop(); window.location.href = SSO_HREF; }}
          >
            {t('tryAgain')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen min-h-dvh flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--fg)' }}>__APP_NAME__</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('redirecting')}</p>
        <a href={SSO_HREF} className="btn-primary block w-full justify-center py-2.5 min-h-11">
          {t('signInWithSalesPort')}
        </a>
      </div>
    </main>
  );
}

// useSearchParams() needs a Suspense boundary during static generation.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
