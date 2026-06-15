---
type: project_context
title: Current repo topology is Payload admin plus service-heavy backend
created: 2026-06-15
---

As of 2026-06-15, this repo is a Payload CMS 3.73 + Next.js 15 app whose active `src/app` tree is mostly Payload admin and API routes, not the older frontend route structure still mentioned in some docs/indexes. Current active boundaries:

- `src/payload.config.ts` wires Payload, MongoDB, 42 collection entries, globals, jobs, custom endpoints, and Vercel-production `onInit` skips.
- `src/server/payload/collections/` is the schema center; collection files plus subfolders cover content, payments, tenants, chat/memory, uploads, enrollments, and jobs/audit support.
- `src/app/api/` has 56 route files, with heavy clusters under `admin`, `agent`, `cron`, `exercises`, `lesson-duplications`, `lessons`, `webhooks`, and account/user settings.
- `src/infra/` is large and current. AI/LLM code lives under `src/infra/llm`, analytics under `src/infra/analytics`, auth under `src/infra/auth`, blob/media/security/runtime config under matching infra folders.
- `src/ui/admin` and `src/ui/shared` are the active component roots; avoid new `src/components`.
- `src/lib` still exists despite the "no new lib folder" convention, but current contents are narrow legacy/domain utilities: latex parser, context exercise parser, payment helpers, product feature keys, and dates.

Scoped repo size from a 2026-06-15 scan: about 1,665 files and 325k text lines across `src`, `tests`, `docs`, `.ai-docs`, `scripts`, and `eslint-plugin-aguy`.
