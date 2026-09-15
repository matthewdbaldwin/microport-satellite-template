# CLAUDE.md — microport-satellite-template

This repo is the scaffold generator new MicroPort satellites are created from
(`scaffold.mjs`). It is not itself a product satellite.

## Fleet conventions

Fleet-wide commit-message format and contribution conventions are hosted centrally, not
copied into this repo or into scaffolded output:

- `microport-infra/docs/COMMIT_CONVENTION.md`
- `microport-infra/docs/CONTRIBUTING.md`

A scaffolded satellite's own root `CLAUDE.md` should point at those two files rather than
copying their content in — a per-repo copy of cross-cutting policy has no reason to be
updated when the source changes, and this fleet has already hit that exact rot twice (see
`~/dev/.claude/CLAUDE.md`'s own note on this). `scaffold.mjs` does not currently generate
this pointer section automatically; a follow-up should teach it to, so every new satellite
starts with the pointer already in place instead of it being added by hand later.

This repo has no `CHARTER.md`/`SECURITY.md` of its own (it isn't a product). A satellite
scaffolded from this template that adds those files should describe its own product
domain and control posture — not copy another repo's. See
`microport-infra/docs/README.md` for why CHARTER.md/SECURITY.md stay per-repo rather than
being centralized.

Decision record: CV-1 in `HANDOFF_fleet_repo_conventions_unification_2026-09-13.md`.
