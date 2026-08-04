// Golden-lock role contract — role drift becomes a RED TEST, not a prod 403.
// reference: prd_microport_contracts, prd_reviewport_sso_role_map.
//
// Until Phase 4 registers "__APP_SLUG__" in microport-contracts roles.ts
// ROLE_CONTRACTS, the app-specific contract assertions are skipped with a loud
// reminder (so day-one CI is green). The IMPORT SHAPE checks below are gated
// only on the require succeeding, NOT on `registered` — see why immediately
// underneath.
'use strict';

let contracts = null;
let ROLE_CONTRACTS = {};
let mapContractRole = () => null;
try {
  contracts = require('@matthewdbaldwin/microport-contracts');
  ({ ROLE_CONTRACTS, mapRole: mapContractRole } = contracts);
} catch { /* contracts not installed in this checkout yet */ }

const APP = '__APP_SLUG__';
const registered = !!(ROLE_CONTRACTS && ROLE_CONTRACTS[APP]);

// ── Import-shape guard — runs whenever contracts IS installed ───────────────
// This block exists because the version of this file that shipped in the
// template until 2026-08-03 could not fail. It destructured `mapContractRole`
// (which does not exist), pre-seeded a `() => null` stub, and gated every
// assertion behind `registered` — false on a fresh mint. So a brand-new
// satellite whose auth middleware imported the same wrong name, and therefore
// threw on every single request, had a GREEN role-contract suite. The test
// masked the bug it existed to catch. Gated on `contracts` (require succeeded),
// NOT on `registered` — the import binding is broken or not regardless of
// whether Phase 4 has happened yet.
(contracts ? describe : describe.skip)('microport-contracts import shape', () => {
  test('mapRole is exported and callable', () => {
    expect(typeof mapContractRole).toBe('function');
  });

  test('ROLE_CONTRACTS is exported', () => {
    expect(ROLE_CONTRACTS).toBeDefined();
    expect(typeof ROLE_CONTRACTS).toBe('object');
  });

  test('mapContractRole is NOT an export — do not import that name', () => {
    // Guards the specific mistake, so a future edit that "helpfully" switches
    // the import back fails here with an explanation rather than at runtime.
    expect(contracts.mapContractRole).toBeUndefined();
  });

  test('mapRole takes a wire-role STRING, not the whole SSO payload', () => {
    // The second load-bearing half of the same bug: auth.js called
    // mapContractRole(APP, payload) instead of passing
    // payload.app_roles[APP]. Handed an object, mapRole returns null — which
    // reads as "not granted" and 403s every user. Assert the object form does
    // NOT resolve, so the correct call site can't regress silently.
    const anyApp = Object.keys(ROLE_CONTRACTS || {})[0];
    if (!anyApp) return; // no registered app to sample — nothing to assert yet
    const wireRole = (ROLE_CONTRACTS[anyApp].ssoGrantable || [])[0];
    if (!wireRole) return;
    expect(mapContractRole(anyApp, wireRole)).not.toBeNull();
    expect(mapContractRole(anyApp, { app_roles: { [anyApp]: wireRole } })).toBeNull();
  });
});

// ── App-specific contract — gated until Phase 4 registration ─────────────────
(registered ? describe : describe.skip)('role contract — __APP_SLUG__', () => {
  test('the primary role maps through', () => {
    expect(mapContractRole(APP, '__PRIMARY_ROLE__')).toBe('__PRIMARY_ROLE__');
  });
  test('an unknown role → null (never a silent grant)', () => {
    expect(mapContractRole(APP, 'not-a-real-role')).toBeNull();
  });
});

if (!registered) {
  test('TODO Phase 4 — register "__APP_SLUG__" in microport-contracts roles.ts', () => {
    // eslint-disable-next-line no-console
    console.warn('[roleContract] "__APP_SLUG__" not yet in ROLE_CONTRACTS — add it + publish before launch (Phase 4), or every hire 403s.');
    expect(registered).toBe(false);
  });
}
