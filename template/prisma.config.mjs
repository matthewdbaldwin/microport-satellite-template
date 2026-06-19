// prisma.config.mjs — Prisma 7 config.
//
// MUST be `.mjs` at the repo ROOT (not inside prisma/), and the Dockerfile MUST
// `COPY prisma.config.mjs ./` — otherwise `prisma migrate deploy` can't find it
// in the container and startup fails. feedback_prisma_config_mjs_not_ts.
import path from 'node:path';

export default {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
};
