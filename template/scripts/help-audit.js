#!/usr/bin/env node
// help-audit.js — read-only static analyzer for the satellite template's help
// surfaces (page-level HelpButton/helpKey coverage, i18n content parity,
// Help Library registry↔content coverage). Companion to
// scripts/help-media-audit.js, which covers help-article MEDIA blocks only —
// deliberately split out, see that script's own header for why.
//
// AUTHORED FRESH FOR THE TEMPLATE — not mechanically copied. The template had
// no help-audit.js before this (only help-media-audit.js, hoisted out of
// SalesPort's original because it has no couplings to any one satellite's
// route/role shape). This script's model is opsport's scripts/help-audit.js
// (the most direct lift from the SalesPort original) and, more closely,
// EngagePort's scripts/help-audit.js — the other "authored fresh, not
// diffed" precedent, written when EngagePort got its first help-audit.js.
// Structural differences vs both, accounted for below:
//
//   - Route shape: the template's web/app has no `(app)` route group
//     (opsport) and is far flatter than any built-out satellite — a fresh
//     mint ships exactly 5 pages: `/`, `/login`, `/auth/callback`, `/help`,
//     `/help/[slug]`. Like EngagePort, this scans web/app directly and uses
//     a BARE_PREFIXES skip list (pre-auth + the help surface itself) rather
//     than a route-group boundary.
//   - Roles: KNOWN_ROLES is hand-kept to match web/components/ui/HelpButton.tsx's
//     own `roles: ['__PRIMARY_ROLE__', 'admin', 'superuser']` list verbatim —
//     including the literal `__PRIMARY_ROLE__` scaffold token. A fresh mint
//     hasn't had that token substituted yet, and auditing it as a real "role"
//     is correct: it's exactly what HelpButton.tsx declares until scaffold.mjs
//     replaces it.
//   - Help Library shape (Check 4): the template is content-module-only
//     (web/lib/help/content/<slug>.ts, one dynamic web/app/help/[slug]/page.tsx
//     route) — no legacy per-slug static pages to fall back to. Same as
//     EngagePort's Help Library 2.0 shape, not opsport's still-migrating
//     dual form.
//   - Gate detection (Check 5): the template's real idiom (grepped from
//     src/routes/*.js + src/middleware/auth.js) is requireAuth applied
//     per-route inline (never only at the app.js mount, unlike EngagePort),
//     a requireRole(...roles) helper (defined in middleware/auth.js, not yet
//     called by any scaffolded route), and `isSuperuser` as a plain boolean
//     field on req.user (a JWT claim, not a callable guard like opsport's
//     requireSuperuser/isSuperuser helpers). There is no allow(...) middleware
//     (EngagePort-only) and no "employee" role/blockEmployee concept
//     (opsport-only) — both are dropped rather than mechanically ported.
//   - Popover-route freshness (Check 7): web/lib/help/popoverRoutes.ts here is
//     explicitly a HAND-KEPT map, not the fleet's generated file — see its own
//     header comment and help-media-audit.js's header (which hit the same
//     issue first). The fleet's generated file is single-object, quoted-key
//     JSON.parse()-able; the template's file holds TWO plain-JS object
//     literals (POPOVER_ROUTES and HELP_KEY_TO_SLUG) with unquoted keys —
//     `home: '/'` is not valid JSON, so JSON.parse() throws. This script
//     parses each block with a small key/value regex instead.
//   - Check 8 is NEW, not present in either reference script: the template
//     consolidates HELP_KEY_TO_SLUG into popoverRoutes.ts (the fleet apps that
//     have this map at all keep it hand-inlined inside HelpButton.tsx and
//     never audit it). HelpButton.tsx's own comment calls out the failure
//     mode directly: "a stale HELP_KEY_TO_SLUG entry degrades to the /help
//     index instead of deep-linking to a 404" — silent, so worth a real check.
//
// What this script checks:
//   1. Every routable page (outside the bare/pre-auth/help-itself prefixes)
//      has a HelpButton with a wired helpKey somewhere in its component tree.
//   2. Every helpKey referenced in code exists in messages/en.json#helpContent
//      with a `default` fallback variant.
//   3. Locale parity across en/zh/fr for helpContent keys + role variants;
//      role variants are checked against KNOWN_ROLES.
//   4. Every slug in HELP_SECTIONS (web/lib/help/sections.ts) resolves to a
//      content module (web/lib/help/content/<slug>.ts) when status is 'live',
//      or has no module yet when status is 'stub'.
//   5. Help-item role gating (gateRefs) roughly matches the underlying
//      route's real auth gate.
//   6. Live articles' declared `labels` don't reference UI text that has
//      vanished from components/app/messages (renamed-button detector).
//   7. Every popover helpKey resolves to an entry in the hand-kept
//      POPOVER_ROUTES map, and that map has no stale entries.
//   8. Every HELP_KEY_TO_SLUG entry resolves to a real HELP_SECTIONS slug.
//
// Usage:
//   node scripts/help-audit.js          # human-readable summary
//   node scripts/help-audit.js --json   # machine-readable

const fs   = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const WEB  = path.join(REPO, 'web');
const APP_ROUTES_GLOB = [
  path.join(WEB, 'app'),
];
const LOCALES = ['en', 'zh', 'fr'];

// Mirrors web/components/ui/HelpButton.tsx's own `roles:` list verbatim,
// scaffold token included — see header comment above.
const KNOWN_ROLES = new Set(['__PRIMARY_ROLE__', 'admin', 'superuser']);

// Prefixes that render bare / pre-auth, or ARE the help surface (so they
// don't need their own HelpButton). A fresh mint has no route groups, so
// this is a flat prefix list rather than a directory boundary.
const BARE_PREFIXES = ['/login', '/auth', '/help'];

const SUMMARY_MAX = 240;

const findings = { blocker: [], warning: [], nit: [] };
const add = (sev, kind, msg, ref) => findings[sev].push({ kind, msg, ref });

function findPages(rootDirs) {
  const pages = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') pages.push(full);
    }
  }
  for (const r of rootDirs) walk(r);
  return pages;
}

function pageToRoute(file) {
  const rel = path.relative(WEB, path.dirname(file)).split(path.sep)
    .filter(seg => !(seg.startsWith('(') && seg.endsWith(')')))  // route groups (none today; kept for parity with the fleet script shape)
    .join('/');
  // rel is "app" for the root page.tsx, "app/help" for /help, etc.
  const withoutApp = rel.replace(/^app\/?/, '');
  return '/' + withoutApp;
}

function isBareRoute(route) {
  return BARE_PREFIXES.some(p => route === p || route.startsWith(p + '/'));
}

// Strip JS comments so example helpKeys in doc-comments (e.g. the local
// HelpButton wrapper's usage examples) aren't counted as real references.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // line comments (keep http:// etc.)
}

function helpKeyUsage(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const re = /HelpButton[\s\S]*?helpKey=\{?["']([\w-]+)["']\}?/g;
  const keys = new Set();
  let m;
  while ((m = re.exec(src)) !== null) keys.add(m[1]);
  return keys;
}

// Resolve a local import specifier (from `file`) to an on-disk path.
// Handles the `@/` alias (→ web/) and relative imports; tries the usual
// extension / index resolutions. Returns null for bare (node_modules) specs.
function resolveLocalImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(WEB, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare specifier — external package
  const candidates = [
    base, `${base}.tsx`, `${base}.ts`,
    path.join(base, 'index.tsx'), path.join(base, 'index.ts'),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* keep trying */ }
  }
  return null;
}

// A thin page.tsx may render a screen component imported from web/components/*
// where the HelpButton actually lives. Follow local imports (bounded depth)
// to find a wired helpKey anywhere in the page's import tree.
//
// Comments MUST be stripped before testing each visited file, not only the
// entry page: the template's own web/components/ui/HelpButton.tsx — the
// single wrapper every screen imports — carries a doc-comment usage example
// (`<HelpButton helpKey="home" role={user?.role} />`). Every page that
// imports HelpButton at all transitively visits that file, so without
// stripping, this check would find a "match" there for every page in the app
// regardless of whether that page itself actually wires a real helpKey —
// silently defeating Check 1. (opsport/EngagePort don't hit this because
// their HelpButton wrappers don't happen to carry an inline usage example in
// a doc-comment; the template's does.)
function helpKeyInImportTree(entryFile, maxDepth = 4) {
  const seen = new Set();
  const importRe = /import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  function visit(file, depth) {
    if (depth > maxDepth || seen.has(file)) return false;
    seen.add(file);
    let src;
    try { src = stripComments(fs.readFileSync(file, 'utf8')); } catch { return false; }
    if (/HelpButton[\s\S]*?helpKey=\{?["'][\w-]+["']\}?/.test(src)) return true;
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const resolved = resolveLocalImport(m[1], file);
      if (resolved && visit(resolved, depth + 1)) return true;
    }
    while ((m = dynamicRe.exec(src)) !== null) {
      const resolved = resolveLocalImport(m[1], file);
      if (resolved && visit(resolved, depth + 1)) return true;
    }
    return false;
  }
  return visit(entryFile, 0);
}

function scanForHelpKeysIn(rootDirs) {
  const used = new Set();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx|ts)$/.test(entry.name)) continue;
      try {
        for (const k of helpKeyUsage(full)) used.add(k);
      } catch { /* ignore */ }
    }
  }
  for (const r of rootDirs) walk(r);
  return used;
}

function loadLocale(name) {
  const file = path.join(WEB, 'messages', `${name}.json`);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    add('blocker', 'parse', `Failed to parse messages/${name}.json: ${err.message}`, file);
    return {};
  }
}

// Parse HELP_SECTIONS via a regex on the TS source so we don't have to
// import a runtime ES module here. The shape is stable.
function loadHelpSections() {
  const file = path.join(WEB, 'lib', 'help', 'sections.ts');
  if (!fs.existsSync(file)) {
    add('blocker', 'missing-sections-registry', 'web/lib/help/sections.ts not found — the help-library index has no source of truth.', file);
    return [];
  }
  const src = fs.readFileSync(file, 'utf8');
  const items = [];
  const itemRe = /\{[^{}]*?slug:\s*'([\w-]+)'[^{}]*\}/g;
  let m;
  while ((m = itemRe.exec(src)) !== null) {
    const block = m[0];
    const statusMatch = block.match(/status:\s*'(live|stub)'/);
    if (!statusMatch) continue;
    const rolesMatch = block.match(/roles:\s*\[([^\]]*)\]/);
    const roles = rolesMatch ? (rolesMatch[1].match(/'([\w-]+)'/g) || []).map(s => s.replace(/'/g, '')) : null;
    const superuserOnly = /superuserOnly:\s*true/.test(block);
    const gateRefsMatch = block.match(/gateRefs:\s*\[([^\]]*)\]/);
    const gateRefs = gateRefsMatch
      ? (gateRefsMatch[1].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''))
      : [];
    items.push({ slug: m[1], status: statusMatch[1], roles, superuserOnly, gateRefs });
  }
  return items;
}

// The hand-kept web/lib/help/popoverRoutes.ts (see header comment — this is
// NOT the fleet's generated, JSON-parseable file). Extract each named
// `Record<string, string>` object literal with a bounded, non-greedy regex
// (no nested braces in either map) and read its key/value pairs by hand.
// Keys here are bare JS identifiers (unquoted), unlike the fleet's quoted
// JSON keys — the value-matching half still only accepts quoted strings.
function parseRecordLiteral(src, constName) {
  const re = new RegExp(constName + '\\s*:\\s*Record<[^>]*>\\s*=\\s*\\{([\\s\\S]*?)\\};');
  const m = src.match(re);
  if (!m) return null;
  const out = {};
  const pairRe = /['"]?([\w.-]+)['"]?\s*:\s*['"]([^'"]*)['"]/g;
  let pm;
  while ((pm = pairRe.exec(m[1])) !== null) out[pm[1]] = pm[2];
  return out;
}

function loadPopoverMaps() {
  const file = path.join(WEB, 'lib', 'help', 'popoverRoutes.ts');
  if (!fs.existsSync(file)) return { file, popoverRoutes: null, helpKeyToSlug: null };
  const src = fs.readFileSync(file, 'utf8');
  return {
    file,
    popoverRoutes: parseRecordLiteral(src, 'POPOVER_ROUTES'),
    helpKeyToSlug: parseRecordLiteral(src, 'HELP_KEY_TO_SLUG'),
  };
}

function readAllSources() {
  const parts = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(e.name)) {
        try { parts.push(fs.readFileSync(full, 'utf8')); } catch { /* ignore */ }
      }
    }
  }
  walk(path.join(WEB, 'components'));
  walk(path.join(WEB, 'app'));
  // UI text is rendered via next-intl, so literal labels live in the message
  // catalogues, not the .tsx source. Include them so the stale-ui-label check
  // matches i18n'd labels instead of false-flagging every one.
  const msgDir = path.join(WEB, 'messages');
  if (fs.existsSync(msgDir)) {
    for (const e of fs.readdirSync(msgDir)) {
      if (e.endsWith('.json')) {
        try { parts.push(fs.readFileSync(path.join(msgDir, e), 'utf8')); } catch { /* ignore */ }
      }
    }
  }
  return parts.join('\n');
}

const pages = findPages(APP_ROUTES_GLOB);
const usedKeys = scanForHelpKeysIn([
  path.join(WEB, 'components'),
  path.join(WEB, 'app'),
]);

const locales = {};
for (const l of LOCALES) locales[l] = loadLocale(l);
const enHelp = locales.en.helpContent || {};
const zhHelp = locales.zh.helpContent || {};
const frHelp = locales.fr.helpContent || {};

const helpItems = loadHelpSections();
const allSlugs  = new Set(helpItems.map(i => i.slug));
const liveSlugs = new Set(helpItems.filter(i => i.status === 'live').map(i => i.slug));
const stubSlugs = new Set(helpItems.filter(i => i.status === 'stub').map(i => i.slug));
const cachedSrc = readAllSources();

// ── Check 1 — every page has at least one helpKey wired ──────────────
for (const page of pages) {
  const rel = path.relative(WEB, page).replace(/\\/g, '/');
  const route = pageToRoute(page);
  if (isBareRoute(route)) continue; // /login, /auth/*, /help/* — pre-auth or the help surface itself

  // Redirect-only pages render no screen of their own — the destination page
  // carries the HelpButton. None exist in the scaffold today, but a minted
  // satellite grows these quickly (e.g. legacy-route redirects); skip them.
  try {
    const pageSrc = fs.readFileSync(page, 'utf8');
    const isRedirectOnly = /\bredirect\(\s*["'`]/.test(pageSrc)
      && !/HelpButton|<[A-Z]\w+/.test(pageSrc.replace(/redirect\([^)]*\)/g, ''));
    if (isRedirectOnly) continue;
  } catch { /* ignore */ }

  const pageDir = path.dirname(page);
  // A page.tsx sitting directly at an APP_ROUTES_GLOB root (the scaffold's
  // own `/` route: web/app/page.tsx, dirname === web/app) has no
  // route-scoped screen directory of its own — its "siblings" would be
  // EVERY other route in the app. Scanning that broadly would make Check 1
  // pass for the root page merely because some unrelated route ships a
  // HelpButton, which defeats the check. Root-level pages rely on direct
  // usage + the import-tree walk only, same as opsport/EngagePort's pages do
  // when their own page.tsx directly wires the HelpButton inline.
  const isRouteRoot = APP_ROUTES_GLOB.includes(pageDir);
  let foundLocal = false;
  function searchDir(dir) {
    if (foundLocal) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) searchDir(full);
      else if (/\.(tsx|ts)$/.test(e.name) && full !== page) {
        try {
          if (helpKeyUsage(full).size) { foundLocal = true; return; }
        } catch { /* ignore */ }
      }
    }
  }
  if (!isRouteRoot) {
    try { searchDir(pageDir); } catch { /* ignore */ }
  }
  try { if (helpKeyUsage(page).size) foundLocal = true; } catch { /* ignore */ }
  // Follow the page's local imports (page → screen component → children):
  // the scaffold wires HelpButton directly in page.tsx, but a grown-out
  // satellite's page usually delegates to a web/components/* screen.
  if (!foundLocal) {
    try { if (helpKeyInImportTree(page)) foundLocal = true; } catch { /* ignore */ }
  }
  if (!foundLocal) {
    add('blocker', 'missing-helpKey-on-page', `Page renders a screen but no HelpButton with helpKey is wired in its tree.`, rel);
  }
}

// ── Check 2 — every helpKey referenced in code exists in en.json ─────
for (const key of usedKeys) {
  if (!enHelp[key]) {
    add('blocker', 'missing-helpkey-content', `helpKey "${key}" referenced in code but missing from messages/en.json#helpContent`, key);
  } else if (!enHelp[key].default) {
    add('blocker', 'missing-default-variant', `helpContent.${key}.default missing in en.json`, key);
  }
}

// ── Check 3 — locale parity ─────────────────────────────────────────
for (const key of Object.keys(enHelp)) {
  if (!zhHelp[key]) add('warning', 'locale-missing', `helpContent.${key} present in en but missing in zh.`, key);
  if (!frHelp[key]) add('warning', 'locale-missing', `helpContent.${key} present in en but missing in fr.`, key);

  const enRoles = Object.keys(enHelp[key]);
  for (const role of enRoles) {
    if (role === 'default') continue;
    if (!KNOWN_ROLES.has(role)) {
      add('warning', 'unknown-role-variant', `helpContent.${key}.${role} isn't one of the template's known roles (${[...KNOWN_ROLES].join(', ')}) — typo, or does HelpButton.tsx's roles list need updating?`, key);
    }
    if (zhHelp[key] && !zhHelp[key][role]) add('warning', 'role-variant-missing', `helpContent.${key}.${role} present in en but missing in zh.`, key);
    if (frHelp[key] && !frHelp[key][role]) add('warning', 'role-variant-missing', `helpContent.${key}.${role} present in en but missing in fr.`, key);
  }

  const summary = enHelp[key]?.default?.summary;
  if (typeof summary === 'string' && summary.length > SUMMARY_MAX) {
    add('nit', 'summary-too-long', `helpContent.${key}.default.summary is ${summary.length} chars (max ${SUMMARY_MAX})`, key);
  }
}

// ── Check 4 — sections.ts live slugs resolve to a content module ─────
// Content-module-only Help Library (no legacy static web/app/help/<slug>/
// page.tsx pages) — every article renders through the single dynamic
// web/app/help/[slug]/page.tsx route via web/lib/help/content/<slug>.ts.
for (const item of helpItems) {
  const contentModule = path.join(WEB, 'lib', 'help', 'content', `${item.slug}.ts`);
  const articleExists = fs.existsSync(contentModule);
  if (item.status === 'live' && !articleExists) {
    add('blocker', 'live-article-missing-file', `HELP_SECTIONS marks "${item.slug}" as live but web/lib/help/content/${item.slug}.ts doesn't exist.`, item.slug);
  }
  if (item.status === 'stub' && articleExists) {
    add('nit', 'stub-with-article', `HELP_SECTIONS marks "${item.slug}" as stub but a real content module exists. Flip status to 'live'.`, item.slug);
  }
}

// ── Check 5 — help-item role gating matches the underlying feature ──
// For every HelpItem with `gateRefs`, read each referenced route file and
// compare the declared (roles + superuserOnly) to the gate tokens present.
//
// The template's real idiom (grepped from src/routes/*.js +
// src/middleware/auth.js): requireAuth is applied per-route, inline in the
// same file (e.g. `router.post('/logout', requireAuth, ...)`) — never only
// at the app.js mount, so (unlike EngagePort) a per-file requireAuth-presence
// check is a meaningful signal here. Role restriction goes through
// requireRole(...roles) (defined, not yet called by any scaffolded route).
// `isSuperuser` is a plain boolean field on req.user (a JWT claim) rather
// than a callable requireSuperuser()/isSuperuser() helper (opsport's idiom).
//
// Two opsport-template sub-checks are deliberately DROPPED, not mechanically
// ported: "gate-help-too-open-employee" (opsport's blockEmployee concept —
// this scaffold has no "employee" role at all) and any allow(...) detection
// (EngagePort's middleware, not used here).
function detectGates(src) {
  return {
    adminOnly:        /\brequireRole\(\s*(?:[^)]*['"]admin['"][^)]*)\)/.test(src),
    requireSuperuser: /\breq\.user\.isSuperuser\b/.test(src) || /\bisSuperuser\b/.test(src),
    requireAuth:      /\brequireAuth\b/.test(src),
  };
}

for (const item of helpItems) {
  if (!item.gateRefs || item.gateRefs.length === 0) continue;
  for (const relPath of item.gateRefs) {
    const filePath = path.join(REPO, relPath);
    if (!fs.existsSync(filePath)) {
      add('warning', 'gate-ref-missing', `helpItem "${item.slug}" gateRefs[${relPath}] doesn't exist on disk — the file may have moved or been deleted.`, item.slug);
      continue;
    }
    const fileSrc = fs.readFileSync(filePath, 'utf8');
    const gates   = detectGates(fileSrc);

    const helpSays = {
      superuserOnly: !!item.superuserOnly,
      adminOnly:     (item.roles?.length === 1 && item.roles[0] === 'admin') && !item.superuserOnly,
    };

    // Mismatch 1 — help is superuserOnly but file shows no superuser gate.
    if (helpSays.superuserOnly && !gates.requireSuperuser) {
      add('warning', 'gate-mismatch-superuser', `Help "${item.slug}" is marked superuserOnly but ${relPath} doesn't check req.user.isSuperuser. Either tighten the route or relax the help gate.`, item.slug);
    }

    // Mismatch 2 — file checks isSuperuser but help doesn't declare superuserOnly.
    if (!helpSays.superuserOnly && gates.requireSuperuser) {
      add('warning', 'gate-help-too-open', `${relPath} checks req.user.isSuperuser but help "${item.slug}" doesn't set superuserOnly: true. Non-superusers will see the help but be blocked from the feature.`, item.slug);
    }

    // Mismatch 3 — help is admin-only but file has no admin-role gate.
    if (helpSays.adminOnly && !gates.adminOnly && !gates.requireSuperuser) {
      add('warning', 'gate-mismatch-admin', `Help "${item.slug}" is admin-only but ${relPath} has no requireRole('admin', ...) / isSuperuser gate. The feature may be more permissive than the help suggests.`, item.slug);
    }

    // Mismatch 4 — file is unauthed but help restricts. Likely a stale gateRef.
    if (!gates.requireAuth && (item.roles?.length || item.superuserOnly)) {
      add('nit', 'gate-ref-unauthed', `${relPath} has no requireAuth in this file. help-audit can't verify gates here — confirm manually if you trust this gateRef.`, item.slug);
    }
  }
}

// ── Check 6 — live articles don't reference vanished UI labels ──────
// Content modules declare UI labels in `labels:` fields on individual
// blocks (e.g. `{ kind: 'paragraph', text: '...', labels: ['Sign in'] }`) —
// read those (more reliable than grepping prose for capitalized phrases).
// The regex is file-scoped, not block-scoped, so it finds every `labels:`
// array regardless of nesting depth.
function contentModuleLabels(file) {
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  const arrRe = /labels\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = arrRe.exec(src)) !== null) {
    const strRe = /['"]([^'"]+)['"]/g;
    let s;
    while ((s = strRe.exec(m[1])) !== null) {
      const label = s[1].trim();
      if (label.length >= 3) out.add(label);
    }
  }
  return [...out];
}

for (const slug of liveSlugs) {
  const contentModule = path.join(WEB, 'lib', 'help', 'content', `${slug}.ts`);
  const labels = contentModuleLabels(contentModule);
  for (const label of labels) {
    if (!cachedSrc.includes(label)) {
      add('warning', 'stale-ui-label-in-article', `web/lib/help/content/${slug}.ts references **${label}** which isn't found in components/app/messages — button may have been renamed`, slug);
    }
  }
}

// ── Check 7 — every popover helpKey resolves to POPOVER_ROUTES; map is fresh ──
const popoverMaps = loadPopoverMaps();
if (!popoverMaps.popoverRoutes) {
  add('blocker', 'popover-routes-missing', 'web/lib/help/popoverRoutes.ts not found (or POPOVER_ROUTES could not be parsed) — the popover→route map has no source of truth.', popoverMaps.file);
} else {
  for (const key of usedKeys) {
    if (!(key in popoverMaps.popoverRoutes)) add('warning', 'popover-route-unresolved',
      `helpKey "${key}" has no entry in POPOVER_ROUTES (web/lib/help/popoverRoutes.ts) — searchable but not clickable from /help search results.`, key);
  }
  for (const key of Object.keys(popoverMaps.popoverRoutes)) {
    if (!usedKeys.has(key)) add('warning', 'popover-route-stale',
      `POPOVER_ROUTES maps "${key}" but no page references that helpKey any more — this is a hand-kept map (see popoverRoutes.ts header), so update it by hand.`, key);
  }
}

// ── Check 8 — every HELP_KEY_TO_SLUG entry resolves to a real HELP_SECTIONS slug ──
// New check, not present in opsport/EngagePort's scripts: the template
// consolidates HELP_KEY_TO_SLUG into popoverRoutes.ts (the fleet apps that
// have this map at all keep it hand-inlined in HelpButton.tsx, unaudited).
// HelpButton.tsx's own comment states the failure mode: a stale entry
// "degrades to the /help index instead of deep-linking to a 404" — silent,
// so worth catching here.
if (popoverMaps.helpKeyToSlug) {
  for (const [key, slug] of Object.entries(popoverMaps.helpKeyToSlug)) {
    if (!allSlugs.has(slug)) {
      add('warning', 'help-key-to-slug-stale', `HELP_KEY_TO_SLUG["${key}"] points at slug "${slug}", which isn't registered in HELP_SECTIONS (web/lib/help/sections.ts) — the popover's "view more" link will silently fall back to the /help index.`, key);
    }
  }
}

// ── output ───────────────────────────────────────────────────────────
const totals = {
  blocker: findings.blocker.length,
  warning: findings.warning.length,
  nit:     findings.nit.length,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    totals,
    findings,
    scanned: {
      pages:        pages.length,
      helpKeys:     usedKeys.size,
      helpArticles: { live: liveSlugs.size, stub: stubSlugs.size },
      locales:      LOCALES,
    },
  }, null, 2));
} else {
  console.log('\n══════ help-audit (template) ══════');
  console.log(`Scanned: ${pages.length} pages, ${usedKeys.size} helpKeys, ${liveSlugs.size} live articles + ${stubSlugs.size} stubs, locales: ${LOCALES.join(', ')}`);
  console.log(`Totals:  ${totals.blocker} blocker / ${totals.warning} warning / ${totals.nit} nit\n`);
  for (const sev of ['blocker', 'warning', 'nit']) {
    const list = findings[sev];
    if (!list.length) continue;
    console.log(`── ${sev.toUpperCase()} (${list.length}) ──`);
    for (const f of list) {
      console.log(`  [${f.kind}] ${f.msg}`);
      if (f.ref) console.log(`             ref: ${f.ref}`);
    }
    console.log('');
  }
  if (totals.blocker > 0) process.exit(1);
}
