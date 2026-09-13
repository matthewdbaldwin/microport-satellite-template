# __APP_NAME__ web image (Next.js). Built + pushed as __APP_SLUG__-web alongside
# the API image (see .github/workflows/deploy.yml) — the fleet runs two images
# per satellite (api + web), one ECS service.
FROM node:22-alpine
WORKDIR /app

# Auth for @matthewdbaldwin/* from GitHub Packages, as a BuildKit SECRET MOUNT.
# Never ARG/ENV a credential: ENV persists into the shipped image config (and the
# running container's env), ARG lands in `docker history`. Both leaked live
# tokens fleet-wide until 2026-09-06. Build with:
#   docker build --secret id=npm_token,env=NODE_AUTH_TOKEN ...
# scripts/check-build-secrets.sh (CI job `build-secrets`) enforces this.
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=npm_token,required=true \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" npm ci

COPY . .
# next.config.ts breaks in prod — keep .js only. feedback_next_config_ts_prod.
RUN rm -f next.config.ts

ARG API_URL=http://localhost:4100
ENV API_URL=${API_URL}

# Sentry build-time vars (optional). NEXT_PUBLIC_SENTRY_DSN is baked into the
# browser bundle (public by design); SENTRY_AUTH_TOKEN authorises source-map
# upload and arrives only as the optional `sentry_token` secret mount below
# (`--secret id=sentry_token,env=SENTRY_AUTH_TOKEN`). Absent → upload is skipped.
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}
ENV SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}

RUN --mount=type=secret,id=sentry_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_token 2>/dev/null || true)" npm run build
RUN npm prune --omit=dev

ENV SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
