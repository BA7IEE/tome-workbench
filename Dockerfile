# Reproducible base verified during this release. See deploy/images.json.
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund
COPY tsconfig.json vite.config.mjs ./
COPY prisma ./prisma
COPY src ./src
COPY web ./web
RUN DATABASE_URL=postgresql://unused:unused@127.0.0.1/tome_build npm run db:generate && npm run build
FROM build AS migration
COPY scripts ./scripts
ENTRYPOINT ["node"]
CMD ["scripts/migrate-safe.mjs", "--production"]
FROM base AS production-dependencies
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund && npm cache clean --force
FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 RUNTIME_DIR=/tmp/tome-run
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json package-lock.json ./
COPY scripts/runtime-lock.cjs scripts/probe.mjs scripts/supervise-container.mjs ./scripts/
RUN mkdir -p data/media && chown -R node:node data
USER node
EXPOSE 4318
HEALTHCHECK --interval=10s --timeout=4s --start-period=30s --retries=3 CMD node scripts/probe.mjs api
ENTRYPOINT ["node"]
CMD ["scripts/supervise-container.mjs", "api"]
