# Google Ads Negative Keyword Sweeper - Cloud Run Job image
# Multi-stage build: compile TypeScript, then run the compiled output only.
# tsconfig.build.json compiles src only (rootDir "."), so the compiled
# entrypoint is dist/src/index.js and the runtime root resolves to /app/dist.

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json \
  && cp src/config/negative-keyword-rules.md dist/src/config/negative-keyword-rules.md \
  && npm prune --omit=dev

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Run artifacts are written under /app/dist/runs (ephemeral unless a volume is mounted).
RUN mkdir -p /app/dist/runs

# Cloud Run Jobs pass arguments via the job's args; default sweeps all organizations
# over the single account-local calendar day 48 hours before execution.
ENTRYPOINT ["node", "dist/src/index.js"]
CMD ["--all-organizations"]
