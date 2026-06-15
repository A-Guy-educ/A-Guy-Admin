---
type: lesson
title: AI indexes are stale; verify with filesystem first
created: 2026-06-15
---

Do not blindly trust `.ai-docs` indexes in this repo until they are regenerated. A 2026-06-15 scan found material drift:

- `.ai-docs/indexes/route-index.json` says 109 routes but 68 indexed files are missing, including many old `src/app/(frontend)` routes. It also misses newer active routes such as account transactions, admin dashboard/recent transactions/refund, lesson duplication process/record/resolve/retry, Stripe/PayPal webhooks, TTS, and lesson export/duplicate/suggested-subject.
- `.ai-docs/indexes/collection-slug-map.json` was generated on 2026-04-15 and lists 31 collections, while `src/payload.config.ts` currently registers 42 collection entries.
- Several docs and indexes still reference old `src/lib/ai` and `src/lib/auth` paths; active AI code is now `src/infra/llm` and active auth infra is under `src/infra/auth`.

Future sessions should use `rg`, `find`, and source files as source of truth, then treat `.ai-docs` as hints. If changing schemas/routes/docs indexes, run the appropriate `pnpm ai:generate-*` command after confirming with the current scripts.
