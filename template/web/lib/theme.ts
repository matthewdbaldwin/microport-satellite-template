// web/lib/theme.ts — __APP_NAME__ theme entrypoint.
//
// SERVER-SAFE: imports from microport-ui/themes (NOT the client root), so
// RootLayout can import it for the inline themeScript without pulling a
// 'use client' module into the server graph. feedback_theme_ts_must_stay_server_safe.
import {
  createThemeApi,
  THEMES,
  DARK_THEME_IDS,
  isDarkThemeId,
  coerceThemeId,
  type ThemeId,
  type ThemeMode,
  type ThemeOption,
} from '@matthewdbaldwin/microport-ui/themes';

export const STORAGE_KEY = '__APP_SLUG___theme';

function saveThemeRemote(id: ThemeId): void {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('__APP_SLUG___token');
  // Fire even without a localStorage token; the HttpOnly cookie may still
  // authenticate the request. reconcile guards on hasLocal.
  fetch('/api/auth/me/theme', {
    method:      'PATCH',
    credentials: 'include',
    headers:     {
      'Content-Type':     'application/json',
      'X-Requested-With': '__APP_SLUG__-web',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:        JSON.stringify({ theme: id }),
    keepalive:   true,
  }).catch(() => { /* swallowed — local cache wins this session */ });
}

const api = createThemeApi({
  storageKey: STORAGE_KEY,
  onSave: saveThemeRemote,
});

export const {
  getStoredTheme,
  applyTheme,
  saveTheme,
  themeScript,
  readRawStoredTheme,
  reconcileThemeWithUser,
} = api;

/** @deprecated use getStoredTheme */
export const getSavedTheme = getStoredTheme;
/** @deprecated use ThemeId */
export type Theme = ThemeId;

export { THEMES, DARK_THEME_IDS, isDarkThemeId, coerceThemeId };
export type { ThemeId, ThemeMode, ThemeOption };
