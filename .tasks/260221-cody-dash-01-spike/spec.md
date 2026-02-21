# TASK-01: CopilotKit + LLM Spike

## Summary
Validate that CopilotKit runtime works with Gemini (primary) or OpenAI (fallback) in our Next.js 15 + React 19 stack. This is a time-boxed spike (2 hours max) — if Gemini adapter fails, switch to OpenAI immediately.

## Task Type
implement_feature

## Requirements

### R1: Install CopilotKit packages
- `pnpm add @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime`
- If using Gemini adapter: also add `@copilotkit/runtime-client-gql` if needed

### R2: Create CopilotKit runtime API route
- File: `src/app/api/copilotkit/route.ts`
- Use `CopilotRuntime` from `@copilotkit/runtime`
- Try `GoogleGenerativeAIAdapter` first (Gemini)
- If it fails (known issue #3217 — "google/undefined" errors), switch to `OpenAIAdapter`
- Use `GEMINI_API_KEY` for Gemini, `OPENAI_API_KEY` for OpenAI (both exist in env)
- Export POST handler

### R3: Create minimal (cody) route group
- File: `src/app/(cody)/layout.tsx` — bare layout with `<html>`, `<body>`, Tailwind CSS
- File: `src/app/(cody)/cody/page.tsx` — client component with `<CopilotKit>` provider + `<CopilotChat>`
- No auth for spike (auth added in TASK-07)

### R4: Wire one test action
- In the page component: `useCopilotAction({ name: 'getCurrentTime', handler: async () => new Date().toISOString() })`
- Verify chat can call the action and display the result

### R5: Verify streaming
- Send a message in the chat
- Verify the response streams token-by-token (not all-at-once)

### R6: Document result
- Write spike result to `.tasks/260221-cody-operations-dashboard/spike-result.md`
- Document: which adapter worked (Gemini/OpenAI), any issues encountered, package versions

## Files to Create/Modify
- `src/app/api/copilotkit/route.ts` (NEW)
- `src/app/(cody)/layout.tsx` (NEW)
- `src/app/(cody)/cody/page.tsx` (NEW)
- `.tasks/260221-cody-operations-dashboard/spike-result.md` (NEW)
- `package.json` (MODIFIED — new deps)

## Acceptance Criteria
- [ ] `/cody` page loads without errors
- [ ] Chat widget appears and accepts text input
- [ ] Sending "what time is it?" triggers the getCurrentTime action
- [ ] Response streams (not blocked)
- [ ] `pnpm tsc --noEmit` passes
- [ ] spike-result.md documents which adapter was used

## Notes
- CopilotKit v1.50+ has a known Gemini adapter regression (issue #3217). If you see "google/undefined" errors, immediately switch to OpenAIAdapter.
- The `(cody)` layout needs its own `<html>/<body>` tags — there's no shared root layout in this project.
- Reference: `src/app/(frontend)/layout.tsx` for layout pattern (but much simpler — no i18n, no locale).
