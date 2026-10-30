# syntax=docker/dockerfile:1
# Builds the Illuminize API from the monorepo root:
#   docker build -f apps/api/Dockerfile -t illuminize-api .
#   docker run --env-file apps/api/.env -p 4000:4000 illuminize-api

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @illuminize/api... --ignore-scripts
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @illuminize/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/package.json ./package.json
# Runtime dependencies only (the shared package is bundled into dist by tsup)
COPY --from=build /repo/node_modules ./node_modules
RUN mkdir -p /app/uploads && chown -R app:app /app
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
# Run pending migrations, then start the API
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
