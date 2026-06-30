import next from 'eslint-config-next';

// Flat config for ESLint 9 / Next 16. `next lint` was removed in Next 16, and
// the prior FlatCompat(extends 'next/core-web-vitals', 'next/typescript') threw a
// "circular structure" error on eslint-config-next@16 — whose main export is now
// a flat-config array, so we spread it directly.
//
// react-hooks rules from React-19/React-Compiler all promoted to error after
// each one was driven to zero platform-wide (2026-05-27):
//   /refs              ✓ rp+ep fixes
//   /static-components ✓ salesport GlobalSearch hoist
//   /purity            ✓ 6 files: Date.now/new Date → module-level helpers
//   /immutability      ✓ FormModal props + SatellitePicker window.location.assign
//   /set-state-in-effect ✓ 194 sites suppressed with eslint-disable-next-line
//                          on legitimate patterns (async fetch, bootstrap,
//                          multi-writer state sync). See [[next16-lint-flat-config]].
//
// No rule overrides remain — every react-hooks rule is at its default (error).
export default [...next];
