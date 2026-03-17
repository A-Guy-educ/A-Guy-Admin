# Plan: 260316-auto-648 — QA Implementation (Critical + High Priority)

## Rerun Context

This is rerun #2. The previous build agent made progress implementing many steps (headers, error boundary, env validation, sentry coverage, etc.) but the pipeline failed at the build stage. The previous build's code changes were reset. This plan is refined from the previous plan with lessons learned from the build events — the implementation approach was sound but the agent ran out of context/time. This plan is streamlined: fewer test steps, clearer priorities, and a recommended execution order that front-loads quick wins.

**Key learnings from previous run:**
- Step 1 (security headers) was implemented successfully — same approach works
- Step 2 (error boundary) was implemented successfully — same approach works  
- Step 3 (env validation) was implemented successfully — same approach works
- Steps 5-7 (Sentry coverage) were implemented but the agent hit context limits
- Step 4 (cherry-pick) should be done FIRST to avoid conflicts with other changes
- Tests should be minimal (file-existence checks, not mock-heavy) to save agent time

## Research Findings

### File Paths Verified
- `next.config.js` ✅ exists (103 lines, no `headers()` function — needs adding)
- `src/app/global-error.tsx` ✅ exists (48 lines — reference pattern)
- `src/app/(frontend)/error.tsx` 🆕 will create
- `src/app/(frontend)/layout.tsx` ✅ exists (confirms route group)
- `src/infra/config/env-validation.ts` 🆕 will create
- `instrumentation.ts` ✅ exists (13 lines, needs env validation hook)
- `src/infra/instrumentation-client.ts` ✅ exists (27 lines, missing browserTracingIntegration)
- `src/ui/cody/github-error-handler.ts` ✅ exists (127 lines, no Sentry import)
- `src/server/api/capture-and-respond.ts` ✅ exists (30 lines — proven pattern)
- `src/server/api/with-api-handler.ts` ✅ exists (117 lines — reference)
- `.github/workflows/ci.yml` ✅ exists (280 lines, test:unit on line 66)
- `vitest.config.unit.mts` ✅ exists (54 lines — already has full coverage config)
- Cherry-pick commit `9631fe7b` ✅ accessible (11 files, 1085 insertions)

### Patterns Observed
- Error boundaries: `'use client'` + `useEffect` → `Sentry.captureException` + locale via `navigator.language`
- `captureAndRespond`: logs + Sentry capture + returns 500 JSON response
- Existing codebase uses dynamic import: `const { captureAndRespond } = await import('@/server/api/capture-and-respond')`
- Cody routes use `requireCodyAuth()` + `handleCodyApiError` for error handling
- `instrumentation.ts` uses `@/` alias for dynamic imports (not relative `./src/`)

## Reuse Inventory

### Existing Utilities to Reuse
- `captureAndRespond` from `src/server/api/capture-and-respond.ts`
- `Sentry` from `@sentry/nextjs` — already used across codebase
- `z` from `zod` — already used in many routes

### NEW Utilities
- `src/infra/config/env-validation.ts` — No existing env validation exists

---

## Step 1: Cherry-pick E2E Tests [FR-004]

**Files to Touch**:
- `tests/e2e/helpers/admin.ts` (NEW — from cherry-pick)
- `tests/e2e/helpers/exercise-builders.ts` (NEW — from cherry-pick)
- `tests/e2e/helpers/verification-fixtures.ts` (NEW — from cherry-pick)
- `tests/e2e/verification/*.e2e.spec.ts` (8 NEW spec files — from cherry-pick)

**Exact Behavior**:
Run `git cherry-pick --no-commit 9631fe7b` to bring in the pre-launch E2E verification suite without auto-committing. This keeps changes staged for the final commit. If conflicts arise, resolve by keeping dev branch patterns.

The commit adds 11 files:
- 3 helper files in `tests/e2e/helpers/`
- 8 spec files in `tests/e2e/verification/`

**Tests**: No additional tests needed — the cherry-pick itself contains 8 test spec files.

**Acceptance Criteria**:
- [ ] All 11 files from commit `9631fe7b` present in working tree
- [ ] No merge conflicts remain

---

## Step 2: Security Headers in next.config.js [FR-001]

**Files to Touch**:
- `next.config.js` (MODIFIED — add `async headers()` property to `nextConfig` object before `reactStrictMode`)

**Exact Behavior**:
Add an `async headers()` function inside the `nextConfig` object (before line 80 `reactStrictMode`) that returns two header groups:

1. **All routes** (`/:path*`): Strict security headers
   - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' *.blob.vercel-storage.com img.youtube.com avatars.githubusercontent.com data:; font-src 'self'; connect-src 'self' *.sentry.io; frame-src 'self' www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'`
   - `X-Frame-Options`: `DENY`
   - `Strict-Transport-Security`: `max-age=31536000; includeSubDomains`
   - `X-Content-Type-Options`: `nosniff`
   - `Referrer-Policy`: `strict-origin-when-cross-origin`
   - `Permissions-Policy`: `camera=(), microphone=(), geolocation=()`
   - `X-DNS-Prefetch-Control`: `on`

2. **Admin routes** (`/admin/:path*`): Override CSP only
   - `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' *.blob.vercel-storage.com avatars.githubusercontent.com data: blob:; font-src 'self' data:; connect-src 'self' *.sentry.io; frame-src 'self'; object-src 'none'; base-uri 'self'`
   - All other 6 headers same as general routes

**Tests**:
- Test location: `tests/unit/config/security-headers.spec.ts`
- Test 1: Verify `nextConfig.headers` is a function by importing the config and calling `headers()`, assert it returns 2 header groups
- Test 2: Verify admin route CSP contains `unsafe-eval`

**Acceptance Criteria**:
- [ ] `headers()` function exists in next.config.js
- [ ] General routes have strict CSP (no `unsafe-eval`)
- [ ] Admin routes have permissive CSP with `unsafe-eval`
- [ ] All 7 headers present on both route patterns

---

## Step 3: Frontend Error Boundary [FR-002]

**Files to Touch**:
- `src/app/(frontend)/error.tsx` (NEW)

**Exact Behavior**:
Create a client component error boundary following `global-error.tsx` pattern but without `<html>/<body>` wrapper (route-group boundaries render inside the layout):
- `'use client'` directive
- Import `* as Sentry from '@sentry/nextjs'` and `useEffect` from `'react'`
- `useEffect(() => { Sentry.captureException(error) }, [error])`
- Detect Hebrew: `typeof navigator !== 'undefined' && navigator.language?.startsWith('he')`
- Content object with: heading, description, tryAgain, reload — bilingual
- Show error message in `<pre>` tag if available
- Two buttons: "Try again" (`reset()`) and "Reload page" (`window.location.reload()`)
- Tailwind classes: `flex flex-col items-center justify-center min-h-screen p-5 text-center`

**Tests**:
- Test location: `tests/unit/frontend/error-boundary.spec.tsx`
- Test 1: Import and render FrontendError component, verify it calls `Sentry.captureException` (mock Sentry)
- Test 2: Verify "Try again" button exists and calls `reset()`

**Acceptance Criteria**:
- [ ] File exists at `src/app/(frontend)/error.tsx`
- [ ] Has `'use client'` directive
- [ ] Calls `Sentry.captureException` in useEffect
- [ ] Locale-aware (Hebrew/English)
- [ ] Reset + reload buttons

---

## Step 4: Env Variable Validation [FR-003]

**Files to Touch**:
- `src/infra/config/env-validation.ts` (NEW)
- `instrumentation.ts` (MODIFIED — add validateEnv call in nodejs block)

**Exact Behavior**:

`env-validation.ts`:
- Import `z` from `zod`
- Define required schema: `z.object({ DATABASE_URL: z.string().min(1), PAYLOAD_SECRET: z.string().min(1), BLOB_READ_WRITE_TOKEN: z.string().min(1) })`
- Define optional server var names: `['SENTRY_DSN', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GITHUB_TOKEN']`
- Define public var names: `['NEXT_PUBLIC_SERVER_URL', 'NEXT_PUBLIC_SENTRY_DSN']`
- Export `validateEnv()` that:
  1. Parses `process.env` against required schema — on failure, throws with formatted error listing each missing var
  2. Loops optional vars — `console.warn` for each missing/empty one
  3. Loops public vars — `console.warn` for each missing/empty one

`instrumentation.ts`:
- Inside the `nodejs` runtime block, after `await import('./sentry.server.config')`, add:
  ```ts
  const { validateEnv } = await import('@/infra/config/env-validation')
  validateEnv()
  ```

**Tests**:
- Test location: `tests/unit/config/env-validation.spec.ts`
- Test 1: `validateEnv()` with all required env vars set → no throw
- Test 2: `validateEnv()` with `DATABASE_URL` missing → throws mentioning "DATABASE_URL"
- Test 3: `validateEnv()` with optional var missing → warns, no throw

**Acceptance Criteria**:
- [ ] `validateEnv()` throws on missing required vars
- [ ] `validateEnv()` warns on missing optional vars
- [ ] `instrumentation.ts` calls `validateEnv()` in nodejs runtime block

---

## Step 5: Enhance handleCodyApiError with Sentry [FR-005a]

**Files to Touch**:
- `src/ui/cody/github-error-handler.ts` (MODIFIED — add Sentry import + captureException call)

**Exact Behavior**:
1. Add `import * as Sentry from '@sentry/nextjs'` at top of file (after existing imports)
2. At the beginning of `handleCodyApiError` function (line 75, after `safeMessage` extraction), add:
   ```ts
   Sentry.captureException(error, {
     tags: { route: `cody/${routeName}` },
   })
   ```
   This single change covers all 20+ Cody routes that call `handleCodyApiError`.

**Tests**:
- Test location: `tests/unit/cody/github-error-handler-sentry.spec.ts`  
- Test 1: Call `handleCodyApiError(new Error('test'), 'test-route')` → verify `Sentry.captureException` called with the error

**Acceptance Criteria**:
- [ ] `Sentry.captureException` called for all error types
- [ ] Existing error response mapping unchanged
- [ ] Existing `console.error` calls preserved

---

## Step 6: Add Sentry to 6 Non-Cody Routes [FR-005b]

**Files to Touch**:
- `src/app/api/conversations/by-context/route.ts` (MODIFIED — 3 catch blocks around lines 58, 120, 150)
- `src/app/api/blob/upload-token/route.ts` (MODIFIED — catch block at line 143)
- `src/app/api/jobs/run-immediate/route.ts` (MODIFIED — catch block around line 159)
- `src/app/api/pdfjs-viewer/route.ts` (MODIFIED — catch block around line 111)
- `src/app/api/copilotkit/route.ts` (MODIFIED — catch block at line 161)
- `src/app/api/agent/message/persist/route.ts` (MODIFIED — non-Zod catch path at line 116)

**Exact Behavior**:
For each route, add `import * as Sentry from '@sentry/nextjs'` at the top, then add `Sentry.captureException(error)` in each catch block alongside existing logging. Do NOT replace existing error response logic — just add the Sentry capture call.

Specific per route:
- **conversations/by-context**: Add `Sentry.captureException(error)` before each `return NextResponse.json` in the 3 catch blocks (GET/POST/DELETE)
- **blob/upload-token**: The outer catch is bare `catch {` — change to `catch (error) {` and add `Sentry.captureException(error)` before the error response
- **jobs/run-immediate**: Add `Sentry.captureException(error)` alongside existing `logger.error` in main catch
- **pdfjs-viewer**: Add `Sentry.captureException(error)` alongside existing `reqLogger.error`
- **copilotkit**: Add `Sentry.captureException(error)` alongside existing `logger.error`
- **agent/message/persist**: Add `Sentry.captureException(error)` in the non-ZodError branch of catch block

**Tests**:
- No dedicated test file for this step — verification via `pnpm -s tsc --noEmit` and manual grep confirming Sentry import in all 6 files

**Acceptance Criteria**:
- [ ] All 6 routes have `Sentry.captureException(error)` in catch blocks
- [ ] All 6 routes import `@sentry/nextjs`
- [ ] Existing error responses unchanged
- [ ] TypeScript compiles

---

## Step 7: Add Sentry to 4 High-Traffic Routes [FR-005c]

**Files to Touch**:
- `src/app/api/agent/chat/route.ts` (MODIFIED — add Sentry import + capture in catch at line 78)
- `src/app/api/agent/chat/stream/route.ts` (MODIFIED — add Sentry import + capture in catch)
- `src/app/api/exercises/import/route.ts` (MODIFIED — add Sentry import + capture in catch at line 48)
- `src/app/api/exercises/validate-answer/route.ts` (MODIFIED — add Sentry import + capture in catch at line 29)

**Exact Behavior**:
For each route, add `import * as Sentry from '@sentry/nextjs'` at top, then add `Sentry.captureException(error, { tags: { route: '<route-path>' } })` in the catch block.

**Note**: These routes delegate to deeper endpoint functions (agentChat, agentChatStream, validateAnswer, importExerciseFromLesson/importExerciseFromImage) that accept PayloadRequest-like objects. Full `withApiHandler` migration would require refactoring those downstream functions. The spec's primary goal is Sentry coverage — achieved by adding `Sentry.captureException` to catch blocks.

**Tests**:
- No dedicated test file — verification via `pnpm -s tsc --noEmit`

**Acceptance Criteria**:
- [ ] All 4 routes have `Sentry.captureException(error)` in catch blocks
- [ ] Existing request flow unchanged
- [ ] TypeScript compiles

---

## Step 8: Zod Validation for 4 Remaining Routes [FR-006]

**Files to Touch**:
- `src/app/api/agent/conversation/route.ts` (MODIFIED — add Zod schema + Sentry)
- `src/app/api/agent/reset-chat/route.ts` (MODIFIED — add Zod schema + Sentry)
- `src/app/api/cody/tasks/route.ts` (MODIFIED — add Zod schema to POST handler around line 357)
- `src/app/api/cody/tasks/approve-review/route.ts` (MODIFIED — add Zod schema + Sentry)

**Exact Behavior**:

**agent/conversation** (POST):
- Add `import { z } from 'zod'` and `import * as Sentry from '@sentry/nextjs'`
- Add schema: `const bodySchema = z.object({ contextKey: z.string().min(1), exerciseId: z.string().optional() })`
- Replace manual `if (!body.contextKey)` check with `const validated = bodySchema.parse(body)` and use `validated.contextKey`
- Add ZodError handling in catch: if `error instanceof z.ZodError`, return 400 with formatted errors
- Add `Sentry.captureException(error)` for non-Zod errors

**agent/reset-chat** (POST):
- Same pattern as conversation but schema: `z.object({ contextKey: z.string().min(1) })`

**cody/tasks POST**:
- Add `import { z } from 'zod'` and `import * as Sentry from '@sentry/nextjs'`
- Add schema: `const createTaskSchema = z.object({ title: z.string().min(1), body: z.string().optional(), labels: z.array(z.string()).optional(), assignees: z.array(z.string()).optional(), actorLogin: z.string().optional(), attachments: z.array(z.any()).optional() })`
- Replace `if (!title)` with `const validated = createTaskSchema.parse(body)` and use validated fields
- Add `Sentry.captureException(error)` in catch block alongside existing `console.error`

**cody/tasks/approve-review** (POST):
- Add `import { z } from 'zod'` and `import * as Sentry from '@sentry/nextjs'`
- Add schema: `const approveReviewSchema = z.object({ prNumber: z.union([z.string(), z.number()]).transform(Number), actorLogin: z.string().optional() })`
- Replace manual `if (!prNumber)` with `const validated = approveReviewSchema.parse(body)` and use `validated.prNumber`
- Add `Sentry.captureException(error)` in catch block alongside existing `console.error`

**Tests**:
- Test location: `tests/unit/api/route-zod-validation.spec.ts`
- Test 1: Conversation schema rejects empty contextKey → ZodError
- Test 2: Tasks POST schema rejects missing title → ZodError
- Test 3: Approve-review schema transforms string prNumber "123" to number 123

**Acceptance Criteria**:
- [ ] All 4 routes have Zod schemas
- [ ] Invalid input returns 400 with structured error
- [ ] All 4 routes have Sentry capture
- [ ] Existing auth checks preserved (requireCodyAuth, verifyActorLogin)

---

## Step 9: CI Coverage Enforcement [FR-007]

**Files to Touch**:
- `.github/workflows/ci.yml` (MODIFIED — line 66 + new step)

**Exact Behavior**:
1. Change line 66 from `run: pnpm test:unit` to `run: pnpm test:unit -- --coverage`
2. Add a new step immediately after:
   ```yaml
   - name: Upload coverage report
     if: always()
     uses: actions/upload-artifact@v4
     with:
       name: coverage-report
       path: coverage/
       retention-days: 7
   ```

**NOTE**: `vitest.config.unit.mts` already has coverage configuration (provider: 'v8', thresholds, reporters). No changes needed there.

**Tests**: No unit test needed — CI configuration change.

**Acceptance Criteria**:
- [ ] `pnpm test:unit -- --coverage` in ci.yml fast-gate job
- [ ] Coverage report uploaded as artifact
- [ ] `vitest.config.unit.mts` unchanged

---

## Step 10: Web Vitals Tracking [FR-008]

**Files to Touch**:
- `src/infra/instrumentation-client.ts` (MODIFIED — add browserTracingIntegration to integrations array)

**Exact Behavior**:
Add `Sentry.browserTracingIntegration()` to the `integrations` array, before the existing `replayIntegration`:

```typescript
integrations: [
  Sentry.browserTracingIntegration(),
  Sentry.replayIntegration({
    maskAllText: true,
    blockAllMedia: true,
  }),
],
```

This automatically captures LCP, FID/INP, CLS, TTFB, FCP at the existing `tracesSampleRate: 0.1`.

**Tests**: No unit test needed — this is a Sentry config addition. Verify via `pnpm -s tsc --noEmit`.

**Acceptance Criteria**:
- [ ] `browserTracingIntegration()` present in integrations array
- [ ] Existing `replayIntegration` preserved
- [ ] `tracesSampleRate` unchanged at 0.1

---

## Verification Plan

After all steps:
```bash
pnpm -s tsc --noEmit                              # TypeScript compilation
pnpm lint                                          # ESLint
pnpm vitest run --config vitest.config.unit.mts    # Unit tests
```

## Step Execution Order

**Recommended order**: 1 → 10 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

Rationale:
- Step 1 (cherry-pick) first to avoid conflicts with later changes
- Step 10 (web vitals) is a 1-line change — do it early
- Steps 2-4 (Phase 1 critical) next
- Steps 5-7 (Sentry) can be done in sequence
- Step 8 (Zod) builds on Sentry patterns
- Step 9 (CI) last since it's non-code
