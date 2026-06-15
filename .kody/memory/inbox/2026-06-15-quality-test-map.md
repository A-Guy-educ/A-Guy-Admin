---
type: project_context
title: Quality and test map for current repo
created: 2026-06-15
---

Testing is broad and split by risk:

- `tests/unit`: about 239 files, 2,968 test cases, 46k lines. Good for pure utilities, UI components, collection schema/hook helpers, ESLint rules, parsing/conversion transforms.
- `tests/int`: about 127 files, 993 test cases, 42k lines. This is the important layer for Payload access, webhooks, payments, chat/memory, cron cleanup, conversion pipelines, tenant/config behavior, and DB invariants.
- `tests/e2e`: about 14 files, 53 test cases, focused on admin dashboard/widgets, lesson blocks, lesson duplication review, and V2 conversion panel behavior.

Quality commands in `package.json`: `pnpm typecheck` runs generated type drift check plus `tsc --noEmit`; `pnpm lint` uses Next/ESLint plus custom `eslint-plugin-aguy`; `pnpm test:unit`, `pnpm test:int`, and `pnpm test:e2e` are separate. The custom ESLint plugin enforces collection access, endpoint auth, file location, no nested metadata, Tailwind/design-token conventions, and no sync exec.

For risky behavior changes, prefer targeted unit or integration tests first, then run the nearest suite. For schema/admin component changes, regenerate Payload types/import map before final verification.
