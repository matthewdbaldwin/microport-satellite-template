# Superpowers — specs & plans

This directory holds the design specifications and implementation plans for non-trivial feature work in this satellite. The convention is shared across the MicroPort platform; see [Plato](https://github.com/matthewdbaldwin/salesport/blob/main/docs/PLATO.md) for the full platform overview.

- **`specs/`** — design specifications. The "what + why" for a feature. One file per spec, named `YYYY-MM-DD-<topic>-design.md`. Spec answers: what are we building, why, what's in scope, what's out, what's deferred, what alternatives were considered.
- **`plans/`** — implementation plans derived from specs. The "how, task by task". One file per plan, named `YYYY-MM-DD-<topic>.md`. Plan is broken into bite-sized tasks with TDD steps + commit cadence so a future engineer (or Claude) can execute mechanically.

A typical feature flow: brainstorm → `specs/<topic>-design.md` → `plans/<topic>.md` → execute. The `superpowers:brainstorming` and `superpowers:writing-plans` skills (Claude Code) automate the spec + plan generation; see SalesPort's `docs/superpowers/` directory for working examples.
