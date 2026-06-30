/**
 * Content-promotion import context + id-on-create guard.
 *
 * The Mongoose adapter sets `allowIDOnCreate: true` globally because the
 * import flow needs to thread source-environment IDs through
 * `payload.create({ data: { id } })`. That setting is global, so without a
 * guard every other code path could also honor a user-supplied `id` —
 * widening ID-prediction / uniqueness-collision surface across all
 * collections (notably Users).
 *
 * The hook returned by `withIdOnCreateGuard` strips `data.id` on create
 * unless the request is flagged via `markRequestAsContentPromotionImport`.
 * Net effect: every collection behaves as if `allowIDOnCreate: false`,
 * except inside the import service.
 */

import type { CollectionConfig, PayloadRequest } from 'payload'

const IMPORT_CONTEXT_KEY = '__contentPromotionImport'

export function markRequestAsContentPromotionImport(req: PayloadRequest): void {
  const ctx = ((req as { context?: Record<string, unknown> }).context ??= {})
  ctx[IMPORT_CONTEXT_KEY] = true
}

export function isContentPromotionImportRequest(req: PayloadRequest | undefined): boolean {
  if (!req) return false
  const ctx = (req as { context?: Record<string, unknown> }).context
  return ctx?.[IMPORT_CONTEXT_KEY] === true
}

export function withIdOnCreateGuard(collection: CollectionConfig): CollectionConfig {
  const existingBeforeChange = collection.hooks?.beforeChange ?? []
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      beforeChange: [
        ({ data, operation, req }) => {
          if (
            operation === 'create' &&
            data &&
            (data as Record<string, unknown>).id !== undefined &&
            !isContentPromotionImportRequest(req)
          ) {
            const cleaned = { ...(data as Record<string, unknown>) }
            delete cleaned.id
            return cleaned
          }
          return data
        },
        ...existingBeforeChange,
      ],
    },
  }
}
