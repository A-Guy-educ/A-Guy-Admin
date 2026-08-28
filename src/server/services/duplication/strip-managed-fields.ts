/**
 * @fileType utility
 * @domain duplication
 * @pattern content-transform
 * @ai-summary Strip Payload-managed virtual fields so a doc is safe to spread into `create`.
 *
 * Shared by every duplicate path (studio section duplicate, exercise deep
 * duplicate, course deep duplicate). Previously duplicated between
 * `endpoints/studio/duplicate-section.ts` and
 * `services/duplication/clone-sections-for-exercises.ts` — the two copies
 * had already started to drift (one stripped `slug` inline downstream, one
 * expected the caller to handle it). Extracted so the next managed field
 * (e.g. `_status`, `sizes`) can be dropped in one place.
 */
export function stripManagedFields<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = doc as T & {
    id?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }
  void _id
  void _c
  void _u
  return rest
}
