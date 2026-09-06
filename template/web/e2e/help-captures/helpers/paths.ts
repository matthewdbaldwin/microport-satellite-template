// web/e2e/help-captures/helpers/paths.ts
// Single source of truth for where a capture run's files live, shared by
// clip.ts (the deliverables) and playwright.help-capture.config.ts
// (Playwright's own per-test artifacts, the "raw" leftovers). If the two
// ever computed this independently and drifted, build.js would silently
// find no captures and the whole pipeline would produce nothing with no
// error.
//
// The directory name `raw` is load-bearing: tools/help-media/build.js:119
// skips exactly that name when it enumerates slug directories under `.out/`.

import path from 'path';

// helpers -> help-captures -> e2e -> web -> repo root
export const OUT_ROOT = path.join(__dirname, '..', '..', '..', '..', 'tools', 'help-media', '.out');

// Playwright's own artifacts, not the deliverables. clip.ts writes the
// keepers to OUT_ROOT/<slug>/ and deletes the copy that lands here.
export const RAW_DIR = path.join(OUT_ROOT, 'raw');
