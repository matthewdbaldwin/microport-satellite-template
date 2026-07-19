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
- ✓ `createVerifier` wired correctly: **`publicKey` = the DECODED PEM** (base64-decode `SALESPORT_JWT_PUBLIC_KEY`), issuer pinned at config, **`audience` passed at the VERIFY CALL** (`verify(token, { audience })`), NOT in config. The `publicKeyBase64` + config-audience wiring throws "audience is required" on every request → 401 loop. Never `if(!token) return` post-Ph4. → `feedback_createverifier_wiring_publickey_call_audience`, `feedback_phase4_cookie_vs_bearer_drift`
- ✓ **SSO callback loop guard** — callback redirects to `/login?sso_err=<code>` on role-deny; login honors `?sso_err` + a sessionStorage attempt-counter and dead-ends instead of re-looping. → `feedback_sso_callback_loop_trap`
- ✓ Proxy 401 cascade scoped to `/auth/me` only. → `feedback_proxy_401_cascade`
- ✓ SsoClaims via the microport-auth verifier (`claimsMode`, env `SSO_CLAIMS_MODE`).

## Phase 5 — Webhook channels  *(stamped)*
- ✓ Canonical `WEBHOOK_SECRET_<FROM>_<TO>` (**UPPERCASE** app names — `bugReports.js` builds the env name via `'__APP_SLUG__'.toUpperCase()`); receiver **verifies signature BEFORE ack**; **2xx for data-level errors, 5xx transient only** (else the outbox retries forever). → `feedback_data_level_errors_must_return_2xx`
- ✓ **Inbound SSO-lifecycle receiver** = `src/routes/ssoLifecycle.js` at `/api/sso/lifecycle/{event,state}` via microport-auth `createLifecycleGuard` (header `x-salesport-signature`, secret `SALESPORT_LIFECYCLE_SECRET`, fails CLOSED unless `ALLOW_UNSIGNED_LIFECYCLE=true`), + a `UserLifecycleEvent` model for audit + `X-Lifecycle-Event-Id` dedup. This is the ONLY inbound channel — salesport's `lifecycle.js` targets `<SLUG>_LIFECYCLE_URL` + `/event`, so a legacy `/api/webhooks/*` receiver silently 404s. → `feedback_scaffold_bug_report_fleet_pattern`
- ✓ Unauthenticated ingress router mounted **before** bare `/api` requireAuth; rawBody + CSRF `BOOTSTRAP_PATHS` allowlist (`/sso/lifecycle`). → `feedback_csrf_bootstrap_allowlist_drift`, `feedback_express_mount_prefix_path_check`
- ✓ Outbound (bug reports) = **synchronous signed POST** to the central queue `/api/bug-reports/cross-app` (`src/routes/bugReports.js`, `signWebhookBody`, `x-bugreport-signature`, 10s timeout, `BugReportCrossApp` contract validated on send). **Hub-first (Matt 2026-07-09):** target = `BUGREPORT_FORWARD_URL || SALESPORT_API_URL`, secret = `BUGREPORT_FORWARD_SECRET || WEBHOOK_SECRET_<APP>_SALESPORT` — blank forward vars keep the legacy SalesPort JSON path, set them to route to HubPort. An OPTIONAL screenshot rides as a `multipart/form-data` `screenshot` part when the target is the hub (`BUGREPORT_FORWARD_URL` set); against SalesPort's JSON-only receiver the image is dropped (warn) and the text leg still lands. NOT a durable outbox — the scaffold's never-drained outbox is a known trap. → `feedback_scaffold_bug_report_fleet_pattern`
- ☐ **MANUAL: set the channel + lifecycle secrets on both task defs' `<slug>-api` container** (programmatic, never a CLI literal). → `reference_webhook_topology`

## Phase 5b — Register the mint at HubPort  *(MANUAL — hub-side)*
HubPort is the fleet IdP + launcher + central bug queue since the 2026-07-11 cutover (`reference_hubport_prod_cutover_runbook`). A new satellite is invisible to it until it's registered **in HubPort's repo** — these are hub-side edits, published + deployed from `~/dev/hubport`, NOT in this scaffold:
- ☐ **`src/lib/ssoHandoff.ts` `SSO_APPS`** — add `__APP_SLUG__` so the hub launcher/handoff mints a one-time SSO code for it (else `/sso/exchange` has no app to hand off to).
- ☐ **`src/routes/…/lifecycle.js` `KNOWN_SATELLITES`** — add `__APP_SLUG__` so the hub fans user create/disable/delete lifecycle events out to it (targets `<SLUG>_LIFECYCLE_URL` + `/event`).
- ☐ **`src/middleware/auth.js` `HANDOFF_APPS`** — add `__APP_SLUG__` so hub-minted tokens carry the right audience and the spoke's SSO verifier accepts them.
- ☐ **`WEBHOOK_SECRET___APP_SLUG___HUBPORT`** — set on BOTH the hub task def and this app's `<slug>-api` task def (the bug-report forward channel + any hub→spoke webhook). Programmatic, never a CLI literal.
- ☐ Set **`<SLUG>_LIFECYCLE_URL`** + the spoke's **`HUBPORT_JWKS_URL`** / **`SALESPORT_JWT_PUBLIC_KEY_B`** so the JWKS/second-key path accepts hub-signed tokens (Phase 4 already stamps the spoke side; this is the hub-side pairing). → `reference_hubport_prod_cutover_env_checklist`

## Phase 6 — Frontend platform  *(stamped)*
- ✓ `theme.ts` server-safe — import from `microport-ui/themes`, never the client root. → `feedback_theme_ts_must_stay_server_safe`
- ✓ Re-assert `applyTheme` on mount; reconcile guarded by `hasLocal`. → `feedback_theme_hydration_strip_reassert`, `feedback_theme_login_guard`
- ✓ Reduced-motion kill-switch caps iteration-count (no strobe). → `feedback_reduced_motion_iteration_count_strobe`
- ✓ Tri-locale en/zh/fr via table-driven `LocaleProvider`. → `feedback_locale_provider_table_driven`
- ✓ TopBar page-h1 (no body h1); AppSwitcher entry; BottomNav on mobile. → `feedback_topbar_page_h1_standard`
- ☐ **App shell root = `fixed inset-0 flex overflow-hidden`, NOT `flex h-screen h-dvh overflow-hidden`.** An in-flow `h-screen h-dvh` root lets a vh-vs-dvh / sub-pixel delta grow `<html>` past the viewport → a 2nd (outer) scrollbar + a gap above the TopBar. Pinning the shell out of flow makes it exactly the visual viewport; only `<main>`/sidebar `<nav>` scroll. Fixed across all 5 satellites 2026-06-30. → `reference_microport_com_subdomains` (shell-fix fan-out)
- ✓ Interactive controls meet the **44px tap-target floor** — the `.btn`/`.btn-primary` utility ships `min-height: 44px` + `items-center justify-center`. → `feedback_tap_target_standard`
- ✓ BugReportButton via `createPortal` to body at `bottom-20 md:bottom-4 z-40`, every authed user, POSTs to own `/api/bug-reports` (which signs + forwards to sp). → `bug-report-fanout`, `feedback_helpbutton_inline_zindex`
- ✓ **CSS-var alias block** in `globals.css` (`:root,[data-theme]` → `--fg:var(--text); --danger:var(--red); --danger-fg:var(--accent-fg); --surface-2:var(--surface2)`). The `@theme` block only makes Tailwind CLASSES; raw `var(--fg)`/`var(--danger)` in inline styles resolve to nothing without these. → `feedback_local_theme_cascade_overrides_lib`
- ✓ CSRF: raw XHR sets `X-Requested-With: <slug>-web`; `web/lib/api.ts` surfaces 422 details + scopes the 401 auto-logout to `/auth/me`. → `feedback_csrf_bootstrap_allowlist_drift`, `feedback_validation_details_must_propagate`, `feedback_proxy_401_cascade`
- ☐ Watch local `globals.css` cascade overriding lib themes. → `feedback_local_theme_cascade_overrides_lib`
- ☐ JSX-text apostrophe lint trap (`you'll` in JSX text fails eslint). → `feedback_jsx_text_apostrophe_lint`

## Phase 7 — AWS provisioning (dev first)  *(MANUAL)*
- ☐ **TWO ECR repos** (`<slug>-api` + `<slug>-web`) — the fleet runs two images (API + Next web) per satellite, one ECS service with two containers (deploy.yml builds/pushes both `:latest`, deploy-dev.yml both `:dev`). ECS service in `microport-dev` then `microport`, **bare-named** (`<slug>`); ALB target group + listener rule.
- ☐ **Open the new API port in the task security group** from the ALB SG (dev `sg-01b2d2aaa47f0363c` ← ALB `sg-0b9668543f1166623`; mirror in prod). The shared task SG only allows the ports already-minted satellites use — a new app's API port (ProductPort = 4006) is NOT open by default, so the ALB API health check times out (`Target.Timeout`), the API target never goes healthy, and **every deploy's `wait services-stable` fails** even though the app is up and listening. Web (3000) is shared so it looks fine — only the new API port bites. → `feedback_new_satellite_api_port_sg_ingress`
- ☐ Prod task role (+`ses:SendEmail` **only if it emails**); dev task-role clone **minus SES**; dev logs `/ecs/<slug>-dev-*`. → `reference_dev_task_roles_no_ses`, `feedback_ses_task_role_identity_scoping`
- ☐ Secrets Manager + DML-only `app_runtime` role (B2). → `db_hardening_plan`
- ☐ **Pool cap 5** (not 50); ECS `maximumPercent` **150**. → `rds_connection_pool_exhaustion`

## Phase 8 — CI/CD  *(workflows stamped)*
- ✓ `deploy.yml` (main→prod) + `deploy-dev.yml` (develop→dev) + `security-audit.yml` (weekly npm-audit → deduped `security-alert` issue); ☐ MANUAL: create the OIDC role.
- ✓ **Prod deploy is CI-GATED** — `deploy.yml` triggers on `workflow_run` of "CI" and only proceeds when `conclusion == 'success'`, so a red CI blocks the prod ECS rollout (it deploys the CI-validated `head_sha`, not just the branch tip). Still confirm green via GHA after a ship. → `feedback_deploy_does_not_gate_on_ci`, `feedback_ecs_gha_stale_image`
- ✓ Rate limiters skip **only** `CI=true` → run `CI=true npx jest` locally. → `feedback_rate_limiter_dev_skip`
- ✓ Playwright smoke (BASE_URL suppresses webServer; port 3001 collision). → `feedback_playwright_railway`

## Phase 9 — Footgun gate + ship  *(MANUAL)*
- ☐ Run **recon**, **prisma-migrate-safe**, **vern**, **role-permission-audit**, **code-error-sweep**; then **deploy-verifier** after.
- ☐ **Substantial new logic is TDD by default** — extract the pure logic (mapping / validation / shaping / filtering) into deep modules and lock each with a behavior suite (test-first). `tsc`/`eslint`/`next build`/live-smoke do NOT cover behavior; the seeded tests below are the floor, not the ceiling. → `feedback_substantial_builds_default_to_tdd`
- ☐ Ship **consumers first, SalesPort last**. → `feedback_cross_repo_protocol_change_must_ship_both_sides`

---

### Seeded tests (Phase 9 wants these green on day one)
- `tests/roleContract.test.js` — golden-lock: role drift → red test, not a prod 403.
- `tests/webhook-signature.test.js` — valid 2xx / tampered 401 / data-error 2xx.
- `e2e/smoke.spec.ts` — login → portal, using the testId convention. → `reference_testid_naming_convention`
