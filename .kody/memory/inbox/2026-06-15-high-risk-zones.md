---
type: project_context
title: Highest-risk implementation zones in A-Guy Admin
created: 2026-06-15
---

High-risk zones to inspect carefully before edits:

- Payments: `src/lib/payment/*`, `src/app/api/webhooks/{stripe,paypal}/route.ts`, `Transactions`, `PaymentStats`, `WebhookEvents`, `CouponUsages`, `AccessCodes`, entitlements/enrollments. Preserve idempotency and paid-status gates.
- AI/chat/memory: `src/infra/llm/**`, `src/server/payload/endpoints/agent/**`, `Conversations`, `MemoryItems`, `ChatAssets`, guest session services, vector search and prompt composition.
- Exercise conversion and lesson context: `src/server/services/exercise-conversion/**`, `src/server/services/lesson-context-conversion/**`, `src/server/payload/jobs/pdf-to-exercises*`, `ContextExtractions`, `ExtractionLogs`, `UploadSessions`.
- Lesson duplication: `src/server/services/lesson-duplication/**`, `src/app/api/lesson-duplications/**`, `LessonDuplications`, review UI under `src/ui/admin/LessonDuplicationReview`.
- Config/secrets/tenancy: `ConfigSecrets`, `ConfigValues`, `ConfigAuditLogs`, `Tenants`, `src/infra/config/**`.

Guardrails that matter most in these zones: when passing a user to Payload Local API, set `overrideAccess: false`; in Payload hooks, pass `req` to nested operations; use context flags for self-updating hooks; keep webhook/queue/idempotency behavior covered by integration tests.
