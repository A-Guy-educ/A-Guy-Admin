/**
 * afterRead hook — fills the virtual `segment` (B2B / B2C) and `schools`
 * fields from class membership. Nothing is persisted.
 *
 * N+1 guard: Payload runs collection afterRead hooks for every doc of a
 * find() page concurrently (Promise.all), and each doc reaches this hook
 * synchronously when it is the FIRST afterRead hook. Ids are collected into
 * a request-scoped batch that flushes on the next microtask, so a list page
 * costs one `classes` query + one `schools` query regardless of page size.
 * Keep this hook first in the Users `afterRead` array.
 *
 * Admin readers only (see canSeeUserSegment). This also keeps the lookup off
 * the JWT strategy's per-request user fetch, which runs without req.user.
 */

import type { CollectionAfterReadHook, PayloadRequest } from 'payload'

import { resolveClassMembership } from '../classMembership'
import { canSeeUserSegment, UserSegment } from '../userSegment'

const BATCH_CONTEXT_KEY = 'userSegmentBatch'

interface MembershipBatch {
  ids: Set<string>
  result: Promise<Map<string, string[]>>
}

const loadMembership = (req: PayloadRequest, userId: string): Promise<string[] | undefined> => {
  const context = req.context as Record<string, unknown>
  let batch = context[BATCH_CONTEXT_KEY] as MembershipBatch | undefined

  if (!batch) {
    const ids = new Set<string>()
    const result = Promise.resolve().then(() => {
      // Close the batch before querying so later reads start a fresh one.
      delete context[BATCH_CONTEXT_KEY]
      return resolveClassMembership(req, [...ids])
    })
    batch = { ids, result }
    context[BATCH_CONTEXT_KEY] = batch
  }

  batch.ids.add(userId)
  return batch.result.then((membership) => membership.get(userId))
}

export const attachUserSegment: CollectionAfterReadHook = async ({ doc, req }) => {
  const docId = (doc as { id?: unknown }).id
  if (docId == null || !canSeeUserSegment(req)) return doc

  try {
    const schools = await loadMembership(req, String(docId))
    return {
      ...doc,
      segment: schools ? UserSegment.B2B : UserSegment.B2C,
      schools: schools ?? [],
    }
  } catch (err) {
    // A membership lookup failure must not break user reads.
    req.payload.logger.warn(
      { err: err instanceof Error ? err.message : String(err), userId: docId },
      '[attachUserSegment] class membership lookup failed; returning user without segment',
    )
    return doc
  }
}
