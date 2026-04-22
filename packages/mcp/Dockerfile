# Multi-stage build: pnpm deploy produces a standalone node_modules tree
# containing only what talos-mcp needs, without the workspace's symlink
# graph. The runtime image is a clean node:20-alpine with that flat tree
# plus source.
#
# Build context: the monorepo root (set via docker-compose.yml).

FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /repo

# Copy workspace manifests first so dependency install can cache.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/mcp/package.json packages/mcp/

RUN pnpm install --filter talos-mcp --prod --frozen-lockfile

COPY packages/mcp/src packages/mcp/src
RUN pnpm deploy --filter talos-mcp --prod /deploy

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /deploy .

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["./node_modules/.bin/tsx", "src/transport.ts"]
