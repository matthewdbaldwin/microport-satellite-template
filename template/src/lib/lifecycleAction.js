// src/lib/lifecycleAction.js — pure policy for the SSO-lifecycle receiver.
//
// This satellite's User model is `active`-only (no soft-delete column) and role
// is re-resolved from the SSO claim on every login (requireAuth upserts it), so
// a lifecycle event only ever touches the account-active flag — role changes
// take effect on the user's next login, not here.
//
//   grant / reactivate — re-enable a disabled local user (active=true).
//   revoke             — losing this satellite's grant means no access; the next
//                        login already 403s (no grant → NO_*_ROLE), and this
//                        deactivates the current session immediately (active=false).
//   disable            — salesport account disabled → active=false.
//
// Kept pure (no prisma/express) so the policy is unit-tested in isolation
// (tests/lifecycleAction.test.js); the route wires it to db.user.updateMany.
'use strict';

// decideUserUpdate(kind, existing) → one of:
//   { data: {...} }            — apply this partial update to the local User
//   { noop: true, reason }     — nothing to do (valid, expected)
//   { skip: true, reason }     — unrecognized event kind (audit row still logged)
// `existing` is { active } for the matched local user, or null if none.
function decideUserUpdate(kind, existing) {
  switch (kind) {
    case 'disable':
    case 'revoke':
      if (existing && existing.active !== false) return { data: { active: false } };
      return { noop: true, reason: existing ? 'already-inactive' : 'no-local-user' };

    case 'grant':
    case 'reactivate':
      if (existing && existing.active === false) return { data: { active: true } };
      return { noop: true, reason: existing ? 'already-active' : 'no-local-user' };

    default:
      return { skip: true, reason: 'unknown_kind' };
  }
}

// stateResponse(user) → the microport-contracts LifecycleStateResponse shape the
// salesport reconciler diffs. This satellite has no soft-delete column, so
// deletedAt is always null; `active` maps to the status string the reconciler
// compares, and `role` is the login-persisted value.
function stateResponse(user) {
  if (!user) return { exists: false };
  return {
    exists: true,
    role: user.role,
    status: user.active ? 'active' : 'disabled',
    deletedAt: null,
  };
}

module.exports = { decideUserUpdate, stateResponse };
