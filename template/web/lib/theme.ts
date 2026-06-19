// web/lib/theme.ts — __APP_NAME__ theme entrypoint.
//
// SERVER-SAFE: imports from microport-ui/themes (NOT the client root), so
// RootLayout can import it for the inline themeScript without pulling a
// 'use client' module into the server graph. feedback_theme_ts_must_stay_server_safe.
import {
  createThemeApi,
  THEMES,
  coerceThemeId,
  type ThemeId,
} from '@matthewdbaldwin/microport-ui/themes';

export const STORAGE_KEY = '__APP_SLUG___theme';
export const DEFAULT_THEME: ThemeId = 'navy';

export const themeApi = createThemeApi({
  storageKey: STORAGE_KEY,
  defaultTheme: DEFAULT_THEME,
  // Persist remotely so the choice syncs across satellites. Fire even without a
  // localStorage token (cookie carries auth). reconcile guards on hasLocal.
  saveRemote: async (id: ThemeId) => {
    if (typeof window === 'undefined') return;
    try {
      await fetch('/api/auth/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': '__APP_SLUG__-web' },
        credentials: 'include',
        body: JSON.stringify({ theme: id }),
      });
    } catch { /* best-effort */ }
  },
});

// Inline <script> string for RootLayout <head> — applies the stored theme before
// paint so there's no flash, and is re-asserted on mount (hydration strips
// data-theme). feedback_theme_hydration_strip_reassert.
export function themeScript(): string {
  return `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'${DEFAULT_THEME}';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
}

export { THEMES, coerceThemeId };
export type { ThemeId };
