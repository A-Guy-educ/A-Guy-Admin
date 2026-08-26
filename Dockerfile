# To use this Dockerfile, you have to set `output: 'standalone'` in your next.config.js file.
# From https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile

FROM node:20-alpine AS base

# Install pnpm globally at the base layer so subsequent stages don't
# need to re-install it. corepack was removed from Node in v25+, so
# older Dockerfiles using `corepack enable pnpm` break on modern images.
RUN npm install -g pnpm@9

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then pnpm i --frozen-lockfile --ignore-scripts; \
  else echo "Lockfile not found." && exit 1; \
  fi
# --ignore-scripts skips the postinstall that runs `pnpm generate:types`.
# At the deps stage only package.json + lockfile are copied, so tsconfig
# and source aren't available — payload generate:types fails with
# "Cannot read properties of null (reading 'config')" trying to find
# tsconfig. The build stage below has the full source and re-runs
# `pnpm run build` (which chains through `pnpm generate` → generate:types
# + generate:importmap), so nothing is lost.


# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Dummy env vars for build only. Several plugins/configs throw at
# module-load if their required env vars are missing, and the various
# generate:* scripts have to import payload.config.ts / plugins/index.ts
# to introspect the schema. The values here are never used at runtime —
# the runner stage below inherits from `base`, not `builder`, so these
# ENVs do NOT leak to the running container. Real secrets are injected
# via Render's env vars at runtime.
ENV PAYLOAD_SECRET=build-time-dummy-not-used-at-runtime
ENV BLOB_READ_WRITE_TOKEN=vercel_blob_rw_dummy_for_build

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then pnpm run build; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Remove this line if you do not have this folder
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD HOSTNAME="0.0.0.0" node server.js
