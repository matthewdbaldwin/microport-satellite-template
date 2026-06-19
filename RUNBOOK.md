# RUNBOOK — minting a new MicroPort satellite

Ordered so each phase's prerequisites are already done. The generator stamps the
files; the **☐ MANUAL** items you do yourself. Every step links the footgun memory
that explains *why*.

> Ship rule (all phases): commit straight to `develop` (no PRs for solo work);
> `main` is urgent-only; version bumps on `develop`, **surgical** (never
> `npm install` — it re-resolves the lockfile). Commit from the clean ext4
> clone, never `git add -A` on the NTFS mirror.

---

## Phase 0 — Identity & shape  *(scaffold.config.json)*
- ☐ App name, slug, the role string(s) it introduces.
- ☐ Which cross-app channels it needs (sends to / receives from which apps).
- ☐ Does it send email? → decides `ses:SendEmail` on the prod task role.
- ☐ Does it hold PHI/CRM data? → decides `blockEmployee` posture + GDPR.
- ☐ **FK-table naming**: `users` (@@map, like sp/op) or `User` (default, like rp/cp/ep). Pick one; all hand-written SQL matches. → `feedback_prisma_migration_fk_table_naming_per_repo`

## Phase 1 — Repo skeleton  *(stamped)*
- ✓ `next.config.js` — **never `.ts`** (`.ts` builds locally, breaks in prod). → `feedback_next_config_ts_prod`
- ✓ `prisma.config.mjs` at repo **root**; Dockerfile COPYs it. → `feedback_prisma_config_mjs_not_ts`
- ✓ Multi-stage Dockerfile, `npm ci --omit=dev` at runtime → any runtime `require()` is in `dependencies`; **`prisma` CLI in `dependencies`**. → `feedback_runtime_dep_not_devdep`, `feedback_prisma_cli_stays_in_dependencies`
- ✓ **No `file:` self-deps** in root/web package.json (Docker `npm ci` EUSAGE trap). → `feedback_develop_to_main_bump_breaks_web_lockfile`
- ✓ `require('./package.json')`, never a bare specifier. → `feedback_node_require_bare_specifier`

## Phase 2 — Shared libs + CI access
- ✓ Pin `microport-ui`, `microport-auth`, `microport-contracts` at current versions (inherit the deep modules; don't copy-paste).
- ☐ **MANUAL: grant the new repo "Manage Actions (Read)" on EACH private `@matthewdbaldwin/*` package BEFORE first CI**, or every `npm ci` 403s. → `feedback_new_private_package_ci_access`
- ✓ `NODE_AUTH_TOKEN` on the CI **test** job step (not only deploy). → `feedback_private_gh_packages_dep_needs_token_in_ci_test_job`

## Phase 3 — DB / Prisma / migrations  *(stamped)*
- ✓ `db-migrate.js`: `migrate deploy` (not `db push`), `@prisma/client` **with PrismaPg adapter** (a bare `new PrismaClient()` crashes). → `feedback_prisma7_bare_client_trap`
- ✓ Migrations are **NOT transactional** under adapter-pg → all DDL `IF NOT EXISTS`, idempotent; handle P3005. → `feedback_prisma7_non_transactional_migrations`, `feedback_db_migrate_pattern`
- ✓ adapter-pg SSL = eu-central-1 RDS CA bundle. → `feedback_prisma_adapter_pg_ssl`
- ☐ Enum changes use the 6-step rebuild (no `CREATE TYPE IF NOT EXISTS`). → `feedback_postgres_enum_rebuild`
- ☐ Soft-delete column per model is a deliberate choice (sp User has none on purpose). → `feedback_salesport_user_no_deletedat`, `feedback_softdelete_propagation_gaps`

## Phase 4 — Auth as an SSO spoke  *(stamped)*
- ✓ Cookie auth (B1 Ph4), 15-min access + 90d sliding refresh, rotation-replay detection.
- ☐ **MANUAL: add the platform + its role strings to `microport-contracts` `roles.ts` `ROLE_CONTRACTS`** (ssoGrantable + mapRole) + publish, or hires 403 / `unknown_role`. → `prd_microport_contracts`, `prd_reviewport_sso_role_map`
- ✓ `verifySsoToken` **audience** check; never `if(!token) return` post-Ph4. → `feedback_phase4_cookie_vs_bearer_drift`
- ✓ **SSO callback loop guard** — callback redirects to `/login?sso_err=<code>` on role-deny; login honors `?sso_err` + a sessionStorage attempt-counter and dead-ends instead of re-looping. → `feedback_sso_callback_loop_trap`
- ✓ Proxy 401 cascade scoped to `/auth/me` only. → `feedback_proxy_401_cascade`
- ✓ SsoClaims via the microport-auth verifier (`claimsMode`, env `SSO_CLAIMS_MODE`).

## Phase 5 — Webhook channels  *(receiver + outbox stamped)*
- ✓ Canonical `WEBHOOK_SECRET_<FROM>_<TO>`; receiver **verifies signature BEFORE ack**; **2xx for data-level errors, 5xx transient only** (else the outbox retries forever). → `feedback_data_level_errors_must_return_2xx`
- ✓ Unauthenticated ingress router mounted **before** bare `/api` requireAuth; rawBody + CSRF `BOOTSTRAP_PATHS` allowlist for the ingress route. → `feedback_csrf_bootstrap_allowlist_drift`, `feedback_express_mount_prefix_path_check`
- ✓ Outbound uses microport-auth webhook-sender (sign + `sha256=` + correlation-id + timeout/retry); durable `WebhookOutbox` for at-least-once. → `prd_webhook_sender_offload`
- ☐ **MANUAL: set the channel secret on both task defs' `<slug>-api` container** (programmatic, never a CLI literal). → `reference_webhook_topology`

## Phase 6 — Frontend platform  *(stamped)*
- ✓ `theme.ts` server-safe — import from `microport-ui/themes`, never the client root. → `feedback_theme_ts_must_stay_server_safe`
- ✓ Re-assert `applyTheme` on mount; reconcile guarded by `hasLocal`. → `feedback_theme_hydration_strip_reassert`, `feedback_theme_login_guard`
- ✓ Reduced-motion kill-switch caps iteration-count (no strobe). → `feedback_reduced_motion_iteration_count_strobe`
- ✓ Tri-locale en/zh/fr via table-driven `LocaleProvider`. → `feedback_locale_provider_table_driven`
- ✓ TopBar page-h1 (no body h1); AppSwitcher entry; BottomNav on mobile. → `feedback_topbar_page_h1_standard`
- ✓ BugReportButton via `createPortal` to body at `bottom-20 md:bottom-4 z-40`, every authed user, forwards to sp `/cross-app` signed. → `bug-report-fanout`, `feedback_helpbutton_inline_zindex`
- ✓ CSRF: raw XHR sets `X-Requested-With: <slug>-web`; `web/lib/api.ts` surfaces 422 details + scopes the 401 auto-logout to `/auth/me`. → `feedback_csrf_bootstrap_allowlist_drift`, `feedback_validation_details_must_propagate`, `feedback_proxy_401_cascade`
- ☐ Watch local `globals.css` cascade overriding lib themes. → `feedback_local_theme_cascade_overrides_lib`
- ☐ JSX-text apostrophe lint trap (`you'll` in JSX text fails eslint). → `feedback_jsx_text_apostrophe_lint`

## Phase 7 — AWS provisioning (dev first)  *(MANUAL)*
- ☐ ECR repo; ECS service in `microport-dev` then `microport`, **bare-named** (`<slug>`); ALB target group + listener rule.
- ☐ Prod task role (+`ses:SendEmail` **only if it emails**); dev task-role clone **minus SES**; dev logs `/ecs/<slug>-dev-*`. → `reference_dev_task_roles_no_ses`, `feedback_ses_task_role_identity_scoping`
- ☐ Secrets Manager + DML-only `app_runtime` role (B2). → `db_hardening_plan`
- ☐ **Pool cap 5** (not 50); ECS `maximumPercent` **150**. → `rds_connection_pool_exhaustion`

## Phase 8 — CI/CD  *(workflows stamped)*
- ✓ `deploy.yml` (main→prod) + `deploy-dev.yml` (develop→dev); ☐ MANUAL: create the OIDC role.
- ☐ **CI + Deploy run in PARALLEL on main — red CI does NOT block ECS.** Verify both green via GHA after every ship. → `feedback_deploy_does_not_gate_on_ci`, `feedback_ecs_gha_stale_image`
- ✓ Rate limiters skip **only** `CI=true` → run `CI=true npx jest` locally. → `feedback_rate_limiter_dev_skip`
- ✓ Playwright smoke (BASE_URL suppresses webServer; port 3001 collision). → `feedback_playwright_railway`

## Phase 9 — Footgun gate + ship  *(MANUAL)*
- ☐ Run **recon**, **prisma-migrate-safe**, **vern**, **role-permission-audit**, **code-error-sweep**; then **deploy-verifier** after.
- ☐ Ship **consumers first, SalesPort last**. → `feedback_cross_repo_protocol_change_must_ship_both_sides`

---

### Seeded tests (Phase 9 wants these green on day one)
- `tests/roleContract.test.js` — golden-lock: role drift → red test, not a prod 403.
- `tests/webhook-signature.test.js` — valid 2xx / tampered 401 / data-error 2xx.
- `e2e/smoke.spec.ts` — login → portal, using the testId convention. → `reference_testid_naming_convention`
