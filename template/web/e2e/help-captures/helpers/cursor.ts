// web/e2e/help-captures/helpers/cursor.ts
// Injected with page.addInitScript() before any page script runs.
//
// Two jobs. First, pin the look: light theme and English, so a capture does
// not inherit whatever the last operator session left in localStorage.
//
// ⚠ These key names must match the ones THIS app actually reads. The bare
// scaffold persists neither a theme nor a locale (web/lib/theme.ts only reads
// __APP_SLUG___token), so both writes below are a deliberate no-op until the
// satellite adds a persister. Harmless while that is true, and wrong the
// moment the satellite picks different names: a capture would then silently
// inherit the operator's last theme instead of being pinned. SalesPort's
// equivalents are 'salesport_theme' (web/lib/theme.ts) and 'salesport_locale'
// (web/components/LocaleProvider.tsx) — the same __APP_SLUG__ prefix.
//
// Second, draw the pointer. Playwright moves a real mouse but the browser
// paints no cursor into a recorded video, so without this a clip shows menus
// opening for no visible reason.

export function installCursor(): void {
  try {
    localStorage.setItem('__APP_SLUG___theme', 'light');
    localStorage.setItem('__APP_SLUG___locale', 'en');
  } catch { /* storage unavailable; the capture still works, just themed by default */ }

  const mount = () => {
    if (document.getElementById('hm-cursor')) return;

    const style = document.createElement('style');
    style.textContent = [
      '#hm-cursor{position:fixed;left:0;top:0;z-index:2147483647;width:22px;height:22px;',
      'margin:-11px 0 0 -11px;border:2px solid rgba(0,194,168,.95);border-radius:50%;',
      'background:rgba(0,194,168,.16);pointer-events:none;opacity:0;',
      'transition:left .07s linear,top .07s linear,opacity .2s linear}',
      '#hm-cursor.on{opacity:1}',
      '.hm-ripple{position:fixed;z-index:2147483646;width:16px;height:16px;margin:-8px 0 0 -8px;',
      'border:2px solid rgba(0,194,168,.9);border-radius:50%;pointer-events:none;',
      'animation:hm-ripple .45s ease-out forwards}',
      '@keyframes hm-ripple{to{transform:scale(3.2);opacity:0}}',
    ].join('');
    document.head.appendChild(style);

    const ring = document.createElement('div');
    ring.id = 'hm-cursor';
    document.body.appendChild(ring);

    addEventListener('mousemove', (e) => {
      ring.classList.add('on');
      ring.style.left = `${e.clientX}px`;
      ring.style.top  = `${e.clientY}px`;
    }, true);

    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = 'hm-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top  = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }, true);
  };

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
}
