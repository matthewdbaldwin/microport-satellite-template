// Pure decision logic for the SSO-lifecycle receiver. This satellite's User model
// is `active`-only (no soft-delete) and role re-resolves from the SSO claim on
// login, so a lifecycle event only flips the account-active flag. These functions
// encode that policy in isolation. See src/routes/ssoLifecycle.js.
'use strict';
const { decideUserUpdate, stateResponse } = require('../src/lib/lifecycleAction');

describe('decideUserUpdate', () => {
  test('disable on an active user → deactivate', () => {
    expect(decideUserUpdate('disable', { active: true })).toEqual({ data: { active: false } });
  });
  test('revoke on an active user → deactivate (lost the grant → no access)', () => {
    expect(decideUserUpdate('revoke', { active: true })).toEqual({ data: { active: false } });
  });
  test('disable/revoke on an already-inactive user → noop', () => {
    expect(decideUserUpdate('disable', { active: false }).noop).toBe(true);
    expect(decideUserUpdate('revoke', { active: false }).noop).toBe(true);
  });
  test('grant/reactivate on a disabled user → re-enable', () => {
    expect(decideUserUpdate('grant', { active: false })).toEqual({ data: { active: true } });
    expect(decideUserUpdate('reactivate', { active: false })).toEqual({ data: { active: true } });
  });
  test('grant on an active user → noop (role handled at next login)', () => {
    expect(decideUserUpdate('grant', { active: true }).noop).toBe(true);
  });
  test('any kind with no local user → noop', () => {
    expect(decideUserUpdate('disable', null).noop).toBe(true);
    expect(decideUserUpdate('grant', null).noop).toBe(true);
  });
  test('unknown kind → skip', () => {
    expect(decideUserUpdate('explode', { active: true }).skip).toBe(true);
  });
});

describe('stateResponse', () => {
  test('no user → exists:false', () => {
    expect(stateResponse(null)).toEqual({ exists: false });
  });
  test('active user → contract-shaped state (deletedAt always null, no soft-delete)', () => {
    expect(stateResponse({ role: 'admin', active: true }))
      .toEqual({ exists: true, role: 'admin', status: 'active', deletedAt: null });
  });
  test('disabled user → status disabled', () => {
    expect(stateResponse({ role: 'admin', active: false }))
      .toEqual({ exists: true, role: 'admin', status: 'disabled', deletedAt: null });
  });
});
