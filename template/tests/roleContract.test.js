// Golden-lock role contract — role drift becomes a RED TEST, not a prod 403.
// reference: prd_microport_contracts, prd_reviewport_sso_role_map.
//
// Until Phase 4 registers "__APP_SLUG__" in microport-contracts roles.ts
// ROLE_CONTRACTS, the contract suite is skipped with a loud reminder (so day-one
// CI is green); once registered it becomes a hard guard on the agreed role set.
'use strict';

let ROLE_CONTRACTS = {};
let mapContractRole = () => null;
try {
  ({ ROLE_CONTRACTS, mapRole: mapContractRole } = require('@matthewdbaldwin/microport-contracts'));
} catch { /* contracts not installed in this checkout yet */ }

const APP = '__APP_SLUG__';
const registered = !!(ROLE_CONTRACTS && ROLE_CONTRACTS[APP]);

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
