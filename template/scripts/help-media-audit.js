#!/usr/bin/env node
// help-media-audit.js — read-only gate for help-article media blocks.
//
// The media block (microport-ui >= 0.46.0) points at same-origin files under
// web/public/help-media/. Nothing typechecks those strings, so a renamed clip
// or a translated twin left on an old path fails silently in the browser: a
// <video> whose src 404s just sits on its poster. This script reads the content
// modules as TEXT (no TS runtime here) and pairs every src with a real file.
//
// What it enforces:
//   1. Every media src is a same-origin /help-media/ path (never a CDN or a
//      third-party embed).
//   2. Every referenced src and poster exists under web/public.
//   3. Every media block carries non-empty alt text.
//   4. Every clip (.mp4/.webm) carries a poster.
//   5. Translated twins (foo.fr, foo.zh) show the same assets as foo — only
//      alt and caption are translated; src and poster are shared.
//   6. Nothing is committed under web/public/help-media that no article
//      references (warning: staging an asset ahead of its article is fine).
//
// Usage:
//   node scripts/help-media-audit.js          # human-readable summary
//   node scripts/help-media-audit.js --json   # machine-readable
//
// Exits 1 on any blocker.
//
// ── Why this is its own script, and not a check inside a full help-audit.js ──
// SalesPort carries a 624-line scripts/help-audit.js whose media check this is
// (Check 8). That file is NOT mechanically portable: it hardcodes SalesPort's
// route groups (app/(app), app/portal), carries a SalesPort-specific
// known-unroutable-popover list, and JSON.parse()s web/lib/help/popoverRoutes.ts
// — which only works because SalesPort GENERATES that file with quoted keys. A
// hand-kept map (`home: '/'`, which is what the scaffold ships) makes it throw.
// The media check has none of those couplings: it reads only
// web/lib/help/content/*.ts and web/public/help-media/. Hoisting it alone is
// what makes it portable.

const fs   = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const WEB  = path.join(REPO, 'web');

const findings = { blocker: [], warning: [], nit: [] };
const add = (sev, kind, msg, ref) => findings[sev].push({ kind, msg, ref });

// Strip JS comments so a media block shown as an EXAMPLE in a doc-comment is
// not audited as a real reference.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // line comments (keep http:// etc.)
}

const CONTENT = path.join(WEB, 'lib', 'help', 'content');
const MEDIA   = path.join(WEB, 'public', 'help-media');

// The block regex treats quoted runs as opaque, so a '}' inside a string value
// does not end the match. An earlier version stopped at the first '}' on the
// theory that a media block has no nested object. That is true and beside the
// point: alt text and captions are prose, and prose says things like
// "click {Export}". Truncating there reported a real alt and a real poster as
// missing, in a gate that fails a merge on valid content.
const MEDIA_RE = /\{\s*kind:\s*'media'(?:[^'"}]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")*?\}/g;

// Values may be single- OR double-quoted: a French caption containing an
// apostrophe is written with double quotes. Matching only one style would read
// those as empty and raise a false media-alt-missing blocker. The
// (?:\\.|[^\\])*? run skips backslash escapes, so an escaped quote inside a
// value does not end it early.
const field  = (block, name) => (block.match(new RegExp(name + ':\\s*([\'"])((?:\\\\.|[^\\\\])*?)\\1')) || [null, null, ''])[2];
const isClip = (src) => /\.(mp4|webm)$/i.test(src);

let mediaRefCount = 0;
const perModule  = new Map();   // moduleId ('pipeline', 'pipeline.fr') -> sorted src list
const referenced = new Set();

const modules = fs.existsSync(CONTENT)
  ? fs.readdirSync(CONTENT).filter(f => f.endsWith('.ts')
      && !f.endsWith('.test.ts') && f !== 'index.ts' && f !== 'types.ts')
  : [];

for (const file of modules) {
  const moduleId = file.replace(/\.ts$/, '');
  const source   = stripComments(fs.readFileSync(path.join(CONTENT, file), 'utf8'));
  const srcs     = [];

  for (const block of source.match(MEDIA_RE) || []) {
    const src    = field(block, 'src');
    const alt    = field(block, 'alt');
    const poster = field(block, 'poster');
    mediaRefCount++;
    srcs.push(src);

    if (!src.startsWith('/help-media/')) {
      add('blocker', 'media-src-origin',
        `${moduleId} has a media src "${src}" that is not a same-origin /help-media/ path`, moduleId);
      continue;
    }
    referenced.add(src);
    if (!fs.existsSync(path.join(WEB, 'public', src.replace(/^\//, '')))) {
      add('blocker', 'media-src-missing',
        `${moduleId} references ${src} but no such file exists under web/public`, moduleId);
    }
    if (!alt.trim()) {
      add('blocker', 'media-alt-missing',
        `${moduleId} has a media block with empty alt text (${src}), a clip with no alt is invisible to screen readers and to help search`, moduleId);
    }
    if (isClip(src)) {
      if (!poster) {
        add('blocker', 'media-poster-missing',
          `${moduleId} clip ${src} has no poster, reduced-motion readers would see a blank frame`, moduleId);
      } else {
        referenced.add(poster);
        if (!poster.startsWith('/help-media/')) {
          add('blocker', 'media-src-origin',
            `${moduleId} has a media poster "${poster}" that is not a same-origin /help-media/ path`, moduleId);
        } else if (!fs.existsSync(path.join(WEB, 'public', poster.replace(/^\//, '')))) {
          add('blocker', 'media-poster-missing',
            `${moduleId} clip ${src} names poster ${poster}, which does not exist under web/public`, moduleId);
        }
      }
    }
  }
  perModule.set(moduleId, srcs.slice().sort());
}

// Twin parity: a translated article shows the same assets as its English
// original. Only alt and caption are translated; src and poster are shared.
for (const [moduleId, srcs] of perModule) {
  const m = moduleId.match(/^(.+)\.(fr|zh)$/);
  if (!m) continue;
  const base = perModule.get(m[1]);
  if (!base) continue;
  if (base.join('|') !== srcs.join('|')) {
    add('warning', 'media-twin-mismatch',
      `${moduleId} shows [${srcs.join(', ') || 'none'}] but ${m[1]} shows [${base.join(', ') || 'none'}], translated twins should carry the same media`, moduleId);
  }
}

// Orphans: committed bytes nothing points at. A warning, not a blocker,
// because an asset staged ahead of its article is legitimate.
if (fs.existsSync(MEDIA)) {
  const walkMedia = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkMedia(full); continue; }
      const urlPath = '/' + path.relative(path.join(WEB, 'public'), full).split(path.sep).join('/');
      if (!referenced.has(urlPath)) {
        add('warning', 'media-orphan',
          `${urlPath} is committed under web/public/help-media but no article references it`, urlPath);
      }
    }
  };
  walkMedia(MEDIA);
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
    scanned: { contentModules: modules.length, mediaRefs: mediaRefCount },
  }, null, 2));
} else {
  console.log('\n══════ help-media-audit ══════');
  console.log(`Scanned: ${modules.length} content modules, ${mediaRefCount} media refs`);
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
}
if (totals.blocker > 0) process.exit(1);
