/**
 * Enrollments Expiry Sweeper
 *
 * Flips active enrollments whose `expiresAt` has passed to `status: 'expired'`.
 * Nothing else changes the status when time-limited access lapses, so without
 * this sweep the web-side paywall keeps letting expired users through
 * (its query excludes only `status: 'cancelled'`).
 *
 * Drops to the raw Mongo `updateMany` so the predicate (status='active',
 * expiresAt has passed) is re-evaluated atomically per document at write
 * time. A concurrent admin cancellation between select and update cannot
 * silently overwrite `status: 'cancelled'` with `'expired'`.
 */

import type { Payload } from 'payload'

interface SweepResult {
  matchedCount: number
  modifiedCount: number
}

interface MongoCollection {
  updateMany: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ) => Promise<{ matchedCount: number; modifiedCount: number }>
}

function getEnrollmentsCollection(payload: Payload): MongoCollection | null {
  // Payload's Mongo adapter exposes raw collections at `db.collections`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coll = (payload.db as any).collections?.['enrollments']
  return coll ?? null
}

export async function sweepExpiredEnrollments(payload: Payload): Promise<SweepResult> {
  const coll = getEnrollmentsCollection(payload)
  if (!coll) {
    throw new Error('enrollments collection handle not found on payload.db')
  }

  const now = new Date()

  const result = await coll.updateMany(
    {
      status: 'active',
      expiresAt: { $exists: true, $ne: null, $lte: now },
    },
    {
      // updatedAt refreshed here because the raw updateMany bypasses
      // Payload's timestamp hook — without this, swept rows keep the
      // updatedAt from the original grant and audit trails go stale.
      $set: { status: 'expired', updatedAt: now },
    },
  )

  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  }
}
