# __APP_NAME__ API image. Multi-stage; runtime is prod-only deps.
# feedback_runtime_dep_not_devdep, feedback_prisma_cli_stays_in_dependencies,
# feedback_prisma_config_mjs_not_ts.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json .npmrc ./
# NODE_AUTH_TOKEN is needed to pull the private @matthewdbaldwin/* packages.
ARG NODE_AUTH_TOKEN
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# prisma.config.mjs MUST be copied (root, .mjs) or migrate deploy can't find it.
COPY package*.json prisma.config.mjs ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
# eu-central-1 RDS CA bundle — provide in the build context; required for TLS.
# COPY rds-ca-eu-central-1.pem ./rds-ca-eu-central-1.pem
RUN npx prisma generate
EXPOSE 4100
# Migrate on boot, then serve. Migrations are idempotent (IF NOT EXISTS) because
# adapter-pg runs them non-transactionally. feedback_prisma7_non_transactional_migrations.
CMD ["sh", "-c", "node scripts/db-migrate.js && node src/server.js"]
