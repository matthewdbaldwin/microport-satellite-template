'use client';

// SSO callback — SalesPort redirects here with ?code=<one-time>. The shared
// SsoCallbackPage POSTs it to /api/auth/sso/exchange, which relays to the
// hub's handoff exchange and sets the HttpOnly __APP_SLUG___token cookie. On
// success we stash the token for the theme writer + apply the user's theme,
// then go home. On a NO_*_ROLE / failed exchange the shared page dead-ends
// (no re-loop into /sso/start). feedback_sso_callback_loop_trap.
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { reconcileThemeWithUser } from '@/lib/theme';
import { SsoCallbackPage } from '@matthewdbaldwin/microport-ui';

export default function Page() {
  const router = useRouter();
  const t = useTranslations('auth');
  return (
    <SsoCallbackPage
      onToken={(token, data) => {
        // Both side-effects are BEST-EFFORT and must never fail the login.
        // The shared SsoCallbackPage calls onToken *inside* the exchange
        // promise and reports any throw via its .catch() as "exchange
        // failed" — so an unguarded localStorage write would turn a
        // SUCCESSFUL exchange (HttpOnly cookie already set) into a dead-end
        // error page on any browser that refuses storage, e.g. Safari with
        // "Block all cookies". Guarded independently so a theme failure
        // can't skip the token cache.
        try { localStorage.setItem('__APP_SLUG___token', token); } catch { /* storage blocked */ }
        // Apply the SSO-returned theme before navigating so we don't flash
        // the previous device's theme until AuthContext's /api/auth/me
        // resolves. Only the ?code= exchange returns user data; the legacy
        // #token= path (data undefined) skips it.
        try { if (data) reconcileThemeWithUser(data.user?.theme ?? null); } catch { /* storage blocked */ }
      }}
      onSuccess={() => router.replace('/')}
      onBack={() => router.push('/')}
      messages={{
        completing:     t('callbackCompleting'),
        backToSignIn:   t('callbackBack'),
        exchangeFailed: t('callbackExchangeFailed'),
        noToken:        t('callbackNoToken'),
      }}
    />
  );
}
