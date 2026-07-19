# microport-satellite-template

A generator that mints a new **MicroPort satellite** from zero — pre-wired as an
SSO spoke, webhook-symmetric, themed, tri-locale, bug-reportable, and green
through CI — so the only net-new work is the platform's own business model
(Prisma schema, routes, pages).

It is the executable form of the **new-platform scaffolding runbook** PRD: every
file in `template/` already solves a footgun the platform has been bitten by
before (see the `feedback_*` reference tags throughout). Following
[`RUNBOOK.md`](./RUNBOOK.md) top-to-bottom produces a satellite with **zero
rediscovery**.

## Quick start

```bash
cp scaffold.config.example.json scaffold.config.json
$EDITOR scaffold.config.json          # Phase 0: name, slug, role, fkTable, targetDir
npm run mint:dry                      # preview the file list
npm run mint                          # stamp the new repo into targetDir
```

Then work through the **manual** steps the generator prints (and
[`RUNBOOK.md`](./RUNBOOK.md) details): package-access grants, contracts
`roles.ts`, webhook secrets, AWS, CI OIDC.

## What the generator does vs. what you do

| Generator stamps (deterministic) | You do (per platform) |
|---|---|
| Repo skeleton, Dockerfile, `prisma.config.mjs`, `db-migrate.js` | Phase 0 identity decisions |
| 3 shared libs pinned, `.npmrc`, CI `NODE_AUTH_TOKEN` on test job | **Grant repo Manage-Actions access** on each private pkg |
| SSO-spoke `auth.js` (cookie, claimsMode, contracts role-map, loop guard) | Add platform + role to **contracts `roles.ts`** + publish |
| Webhook receiver (verify-before-ack, 2xx data-level) + outbox | Register **webhook secrets** on both task defs |
| SSO-spoke wiring + hub-first bug-report forward (`BUGREPORT_FORWARD_URL`) | **Register the mint at HubPort** (SSO_APPS / KNOWN_SATELLITES / HANDOFF_APPS / channel secret) — RUNBOOK Phase 5b |
| Theme (server-safe), tri-locale, BugReportButton, AppSwitcher, login `?sso_err` guard | The business **schema / routes / pages** |
| CI/Deploy workflows, role-contract + webhook tests, Playwright smoke | **AWS** provisioning (ECR/ECS/ALB/RDS/secrets/OIDC) |

## Placeholders

`scaffold.mjs` replaces these in file contents **and** paths:

| Token | Example | Drives |
|---|---|---|
| `__APP_NAME__` | `ServicePort` | display name |
| `__APP_SLUG__` | `serviceport` | pkg name, `<slug>-web` id, `<slug>_token` cookie, AWS svc |
| `__APP_TITLE__` | `ServicePort` | nav title |
| `__PRIMARY_ROLE__` | `agent` | seed role string |
| `__FK_TABLE__` | `User` | FK-table naming (`users` @@map vs `User`) |
| `__DB_NAME__` | `serviceport` | local DB name |

## Keeping it current

When a new footgun lands, fix it **here** too — this repo is the canonical
"what a satellite must pre-solve" surface. The source-of-truth narrative lives in
the `prd-new-platform-scaffolding-runbook` memory.
