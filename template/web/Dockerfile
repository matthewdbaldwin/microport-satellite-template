# __APP_NAME__ web image (Next.js). Built + pushed as __APP_SLUG__-web alongside
# the API image (see .github/workflows/deploy.yml) — the fleet runs two images
# per satellite (api + web), one ECS service.
FROM node:22-alpine
WORKDIR /app

# Auth for @matthewdbaldwin/* from GitHub Packages.
ARG NODE_AUTH_TOKEN
ENV NODE_AUTH_TOKEN=${NODE_AUTH_TOKEN}

COPY package*.json .npmrc ./
RUN npm ci

COPY . .
# next.config.ts breaks in prod — keep .js only. feedback_next_config_ts_prod.
RUN rm -f next.config.ts

ARG API_URL=http://localhost:4100
ENV API_URL=${API_URL}

# Sentry build-time vars (optional). NEXT_PUBLIC_SENTRY_DSN is baked into the
# browser bundle; SENTRY_AUTH_TOKEN authorises source-map upload.
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ARG SENTRY_AUTH_TOKEN
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}
ENV SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT}

RUN npm run build
RUN npm prune --omit=dev

ENV SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
