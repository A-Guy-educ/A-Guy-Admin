# Codebase Context: 260316-auto-648

## Files to Modify
- `next.config.js` (lines 80-81) — Add `async headers()` function with split CSP strategy
- `src/app/(frontend)/error.tsx` (NEW) — Create frontend error boundary
- `src/infra/config/env-validation.ts` (NEW) — Create Zod env validation
- `instrumentation.ts` (lines 4-6) — Hook validateEnv() in nodejs runtime block
- `src/infra/instrumentation-client.ts` (line 21) — Add browserTracingIntegration
- `src/ui/cody/github-error-handler.ts` (lines 1-2, 75) — Add Sentry import + captureException
- `src/app/api/conversations/by-context/route.ts` (catch blocks ~lines 58, 120, 150) — Add Sentry capture
- `src/app/api/blob/upload-token/route.ts` (catch at line 143) — Fix bare catch, add Sentry
- `src/app/api/jobs/run-immediate/route.ts` (catch ~line 159) — Add Sentry capture
- `src/app/api/pdfjs-viewer/route.ts` (catch ~line 111) — Add Sentry capture
- `src/app/api/copilotkit/route.ts` (catch at line 161) — Add Sentry capture
- `src/app/api/agent/message/persist/route.ts` (catch ~line 116) — Add Sentry to non-Zod catch
- `src/app/api/agent/chat/route.ts` (catch at line 78) — Add Sentry capture
- `src/app/api/agent/chat/stream/route.ts` (catch block) — Add Sentry capture
- `src/app/api/exercises/import/route.ts` (catch at line 48) — Add Sentry capture
- `src/app/api/exercises/validate-answer/route.ts` (catch at line 29) — Add Sentry capture
- `src/app/api/agent/conversation/route.ts` (full file) — Add Zod schema + Sentry
- `src/app/api/agent/reset-chat/route.ts` (full file) — Add Zod schema + Sentry
- `src/app/api/cody/tasks/route.ts` (POST handler ~lines 357-435) — Add Zod schema + Sentry
- `src/app/api/cody/tasks/approve-review/route.ts` (lines 21-27, catch ~line 109) — Add Zod schema + Sentry
- `.github/workflows/ci.yml` (line 66) — Add --coverage flag + upload artifact step

## Files to Read (reference patterns)
- `src/app/global-error.tsx` — Error boundary pattern (locale detection, Sentry, Tailwind)
- `src/app/(cody)/cody/error.tsx` — Alternative error boundary pattern (no html wrapper)
- `src/server/api/capture-and-respond.ts` — captureAndRespond utility pattern
- `src/server/api/with-api-handler.ts` — withApiHandler pattern reference

## Key Signatures
- `captureAndRespond(error: unknown, context: { route: string; requestId?: string }): NextResponse` from `src/server/api/capture-and-respond.ts`
- `handleCodyApiError(error: unknown, routeName: string): NextResponse<ApiErrorResponse>` from `src/ui/cody/github-error-handler.ts`
- `requireCodyAuth(req: NextRequest)` from `@/ui/cody/auth`
- `verifyActorLogin(req: NextRequest, actorLogin: string)` from `@/ui/cody/auth`
- `getUserOctokit(req: NextRequest)` from `@/ui/cody/auth`

## Reuse Inventory
- `Sentry.captureException` from `@sentry/nextjs` — use directly in all route catch blocks
- `Sentry.browserTracingIntegration` from `@sentry/nextjs` — use in instrumentation-client.ts
- `z` from `zod` — already imported in many files, use for route validation schemas

## Integration Points
- `instrumentation.ts` register() runs at Node.js startup — env validation goes here
- `handleCodyApiError` is imported by 14+ Cody API routes — single change covers all
- `vitest.config.unit.mts` already has coverage config — CI just needs `--coverage` flag
- Cherry-pick commit `9631fe7b` adds 11 files, no conflicts expected on current branch

## Imports Verified
- `@sentry/nextjs` → exports `captureException`, `browserTracingIntegration`, `replayIntegration` ✅
- `@/server/api/capture-and-respond` → exports `captureAndRespond` ✅
- `@/ui/cody/github-error-handler` → exports `handleCodyApiError` ✅
- `@/ui/cody/auth` → exports `requireCodyAuth`, `verifyActorLogin`, `getUserOctokit` ✅
- `@/infra/utils/logger/logger` → exports `logger` ✅
- `zod` → exports `z`, `ZodError` ✅
