---
type: project_context
title: API surface mixes Next routes, Payload endpoints, and route wrappers
created: 2026-06-15
---

The API surface has three active styles:

1. Next App Router handlers in `src/app/api/**/route.ts`.
2. Payload custom endpoints in `src/server/payload/endpoints/**`, mounted through Payload and wired in `src/payload.config.ts` for selected endpoint groups.
3. Centralized wrapper routes using `src/server/api/with-api-handler.ts`, which handles `getPayload`, `payload.auth`, auth level checks (`admin`, `adminOrTest`, `authenticated`, `public`), Zod body/query parsing, logging, and Sentry capture.

Not all `src/app/api` routes use `withApiHandler`; many do manual `payload.auth`, CRON secret checks, or webhook signature verification. Cron-like routes use `CRON_SECRET` bearer auth. Stripe and PayPal webhook routes verify provider signatures, dedupe through `webhook-events`, update transactions, and grant entitlements only after payment success conditions.

When adding/changing routes, first find nearby route style with `rg`. Prefer `withApiHandler` for ordinary JSON APIs, but preserve specialized manual patterns for streaming, Payload proxying, cron runners, and provider webhooks.
