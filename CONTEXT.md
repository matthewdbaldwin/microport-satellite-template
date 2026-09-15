# microport-satellite-template

This repo is not a product satellite itself — it's the scaffold generator
(`scaffold.mjs`) new MicroPort satellites are created from, carrying the fleet's shared
baseline (server layout, auth middleware, CI, Dockerfile, help-audit tooling, etc).
There is no product domain of its own to model here; a scaffolded satellite should start
its own `CONTEXT.md` describing *its* domain once it exists.

## Language

No terms captured yet, and none expected to accumulate here — domain terminology belongs
in the satellites this template produces, not in the template itself. This stub exists
only so the template's own root-doc set matches the fleet convention (CV-1).
