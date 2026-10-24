# syntax=docker/dockerfile:1
# whataracket worker image. Build from the repository root:
#   docker build -t whataracket-worker .
# Portainer builds it for you from deploy/stack/*.yml (docs/DEPLOY.md).

ARG NODE_VERSION=22

# --- build: compile TypeScript and pre-bundle the workflow code --------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
COPY tools tools
RUN pnpm install --frozen-lockfile
RUN pnpm build

# --- runtime: production dependencies and compiled output only ---------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# Phase 2 (checkout) drives Chromium through Playwright. Phase 1 only reads
# availability over HTTPS, so the browser is off by default to keep the image
# small. Rebuild with --build-arg INSTALL_CHROMIUM=true when booking lands.
ARG INSTALL_CHROMIUM=false
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    TZ=Europe/London
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=build /app/packages/domain/package.json packages/domain/
COPY --from=build /app/packages/clubspark/package.json packages/clubspark/
COPY --from=build /app/packages/activities/package.json packages/activities/
COPY --from=build /app/packages/workflows/package.json packages/workflows/
COPY --from=build /app/apps/worker/package.json apps/worker/
RUN pnpm install --prod --frozen-lockfile --filter @whataracket/worker... \
 && if [ "$INSTALL_CHROMIUM" = "true" ]; then \
      pnpm --filter @whataracket/clubspark exec playwright install --with-deps chromium; \
    fi \
 && rm -rf /root/.cache /root/.local/share/pnpm
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/clubspark/dist packages/clubspark/dist
COPY --from=build /app/packages/activities/dist packages/activities/dist
COPY --from=build /app/packages/workflows/dist packages/workflows/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
RUN printf '#!/bin/sh\nexec node /app/apps/worker/dist/cli.js "$@"\n' > /usr/local/bin/whataracket \
 && chmod +x /usr/local/bin/whataracket \
 && mkdir -p /requests && chown node:node /requests

USER node
VOLUME ["/requests"]
CMD ["node", "/app/apps/worker/dist/main.js"]
