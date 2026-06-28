/**
 * Feature Quota Service
 *
 * Reads per-user `featureEntitlements` rows and enforces day-bucketed limits.
 * Buckets are calendar days in Asia/Jerusalem (per Task C). Counters are
 * stored on the User document; one (count, bucket) pair per enforceable
 * feature key.
 *
 * Idempotency / concurrency: increments use atomic MongoDB updateOne
 * filters, never read-then-write.
 *
 * @fileType service
 * @domain entitlements
 * @pattern daily-quota, atomic-counter
 * @ai-summary Enforces per-day feature limits (ai-questions, chat-limit) keyed on featureEntitlements value/period
 */

import { ObjectId, type Collection, type Document } from 'mongodb'
import type { Payload } from 'payload'

import type { FeatureKey } from '@/lib/products/feature-keys'

export type FeaturePeriod = 'day' | 'month' | 'lifetime'

export interface FeatureEntitlement {
  key: FeatureKey
  value: number | null
  period: FeaturePeriod
  expiresAt: string | null
  grantedAt: string | null
  transactionId: string | null
}

export interface FeatureQuotaResult {
  allowed: boolean
  used: number
  limit: number
  resetAt: string | null
}

const IL_TIMEZONE = 'Asia/Jerusalem'

/**
 * Calendar day in Asia/Jerusalem as `YYYY-MM-DD`. Used as the bucket key for
 * per-day counters; resets when the bucket changes.
 */
export function getDayBucketIL(date: Date = new Date()): string {
  // en-CA produces the YYYY-MM-DD format directly. Pinned to Asia/Jerusalem
  // so the bucket flips at IL midnight regardless of where the server runs.
  return date.toLocaleDateString('en-CA', { timeZone: IL_TIMEZONE })
}

/**
 * Next Asia/Jerusalem midnight as an ISO string. Tells clients exactly when
 * the counter will reset.
 */
export function getNextDayResetIsoIL(date: Date = new Date()): string {
  // Build the IL local Y/M/D/H/M/S of the input, advance the day by one,
  // zero the time, then convert back through Date.UTC by offsetting for IL.
  // Simpler: render the IL "now" parts, then construct tomorrow IL midnight
  // and let Date interpret it as if local — but IL offset varies (DST), so
  // we approximate by binary searching the next instant whose IL bucket > today.
  //
  // Pragmatic implementation: today's IL bucket vs candidate. Start with
  // now + 25 hours and step back to the moment the IL bucket flipped.
  const todayBucket = getDayBucketIL(date)
  let candidate = new Date(date.getTime() + 25 * 60 * 60 * 1000)
  // Walk back hour by hour while still on tomorrow's bucket.
  while (getDayBucketIL(new Date(candidate.getTime() - 60 * 60 * 1000)) !== todayBucket) {
    candidate = new Date(candidate.getTime() - 60 * 60 * 1000)
  }
  // Now walk back minute by minute to find the exact flip.
  while (getDayBucketIL(new Date(candidate.getTime() - 60 * 1000)) !== todayBucket) {
    candidate = new Date(candidate.getTime() - 60 * 1000)
  }
  return candidate.toISOString()
}

/**
 * Returns the best matching non-expired featureEntitlement for a given key.
 * Per the documented intent in grant-entitlements.ts, when multiple rows
 * exist for the same key (cross-product bundles) the latest by grantedAt
 * wins.
 */
export async function resolveFeatureEntitlement(
  payload: Payload,
  userId: string,
  featureKey: FeatureKey,
): Promise<FeatureEntitlement | null> {
  const user = await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
  })

  const rawEntitlements =
    ((user as unknown as { featureEntitlements?: unknown }).featureEntitlements as
      | Array<Record<string, unknown>>
      | undefined) ?? []

  const now = Date.now()
  const matching: FeatureEntitlement[] = rawEntitlements
    .filter((e) => e.key === featureKey)
    .map((e) => ({
      key: e.key as FeatureKey,
      value: typeof e.value === 'number' ? (e.value as number) : null,
      period:
        e.period === 'day' || e.period === 'month' || e.period === 'lifetime'
          ? (e.period as FeaturePeriod)
          : 'lifetime',
      expiresAt: typeof e.expiresAt === 'string' ? (e.expiresAt as string) : null,
      grantedAt: typeof e.grantedAt === 'string' ? (e.grantedAt as string) : null,
      transactionId: typeof e.transactionId === 'string' ? (e.transactionId as string) : null,
    }))
    .filter((e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now)

  if (matching.length === 0) return null

  // Latest non-expired grant by grantedAt wins.
  matching.sort((a, b) => {
    const aMs = a.grantedAt ? new Date(a.grantedAt).getTime() : 0
    const bMs = b.grantedAt ? new Date(b.grantedAt).getTime() : 0
    return bMs - aMs
  })
  return matching[0]
}

function getUsersCollection(payload: Payload): Collection<Document> | null {
  const db = payload.db as unknown as {
    connection?: { collection?: (name: string) => unknown }
    collections?: Record<string, unknown>
    collection?: (name: string) => unknown
  }
  const collection =
    db.connection?.collection?.('users') ||
    db.collections?.['users'] ||
    (db.collections as Record<string, unknown>)?.users ||
    db.collection?.('users') ||
    null
  return (collection as Collection<Document>) ?? null
}

interface FeatureQuotaFieldNames {
  used: string
  bucket: string
}

const FIELD_NAMES: Record<string, FeatureQuotaFieldNames> = {
  'ai-questions': { used: 'aiQuestionsUsedDay', bucket: 'aiQuestionsBucketDay' },
  'chat-limit': { used: 'chatLimitUsedDay', bucket: 'chatLimitBucketDay' },
}

function fieldsFor(featureKey: FeatureKey): FeatureQuotaFieldNames | null {
  return FIELD_NAMES[featureKey] ?? null
}

/**
 * Atomic check-and-increment for a per-day feature quota.
 *
 * Flow:
 * 1. If period === 'lifetime' or limit is null/undefined, treat as unlimited.
 * 2. Else compute today's IL bucket.
 * 3. updateOne where bucket matches AND used < limit → $inc used (success).
 * 4. updateOne where bucket != today → $set bucket=today, used=1 (success).
 * 5. Both miss → user is at limit in today's bucket (deny).
 */
export async function checkAndIncrementFeatureQuota(
  payload: Payload,
  userId: string,
  featureKey: FeatureKey,
  entitlement: FeatureEntitlement,
): Promise<FeatureQuotaResult> {
  const limit = entitlement.value
  if (limit === null || entitlement.period === 'lifetime') {
    return { allowed: true, used: 0, limit: limit ?? Infinity, resetAt: null }
  }

  // Only 'day' is implemented; 'month' would mirror this with a different bucket.
  if (entitlement.period !== 'day') {
    return { allowed: true, used: 0, limit, resetAt: null }
  }

  const fields = fieldsFor(featureKey)
  if (!fields) {
    // No counter wired for this key — treat as unlimited rather than denying.
    return { allowed: true, used: 0, limit, resetAt: null }
  }

  const collection = getUsersCollection(payload)
  if (!collection) {
    // Adapter shape unavailable — fail open, log via Payload's logger.
    payload.logger.error(
      { userId, featureKey },
      'feature-quota: users mongo collection unavailable; allowing request',
    )
    return { allowed: true, used: 0, limit, resetAt: null }
  }

  const bucket = getDayBucketIL()
  const resetAt = getNextDayResetIsoIL()
  const userObjectId = new ObjectId(userId)

  // Step 1: same bucket, under limit → $inc
  const incResult = await collection.findOneAndUpdate(
    {
      _id: userObjectId,
      [fields.bucket]: bucket,
      [fields.used]: { $lt: limit },
    },
    { $inc: { [fields.used]: 1 } },
    { returnDocument: 'after' },
  )
  if (incResult) {
    return {
      allowed: true,
      used: (incResult[fields.used] as number) ?? 1,
      limit,
      resetAt,
    }
  }

  // Step 2: different (or missing) bucket → reset to today, used=1
  const resetResult = await collection.findOneAndUpdate(
    {
      _id: userObjectId,
      $or: [{ [fields.bucket]: { $ne: bucket } }, { [fields.bucket]: { $exists: false } }],
    },
    { $set: { [fields.bucket]: bucket, [fields.used]: 1 } },
    { returnDocument: 'after' },
  )
  if (resetResult) {
    return { allowed: true, used: 1, limit, resetAt }
  }

  // Step 3: at limit in today's bucket
  return { allowed: false, used: limit, limit, resetAt }
}

/**
 * Read-only quota status — does not increment. Used by the chat-quota
 * endpoint to surface remaining count + resetAt to clients.
 */
export async function getFeatureQuotaStatus(
  payload: Payload,
  userId: string,
  featureKey: FeatureKey,
  entitlement: FeatureEntitlement,
): Promise<FeatureQuotaResult> {
  const limit = entitlement.value
  if (limit === null || entitlement.period === 'lifetime') {
    return { allowed: true, used: 0, limit: limit ?? Infinity, resetAt: null }
  }
  if (entitlement.period !== 'day') {
    return { allowed: true, used: 0, limit, resetAt: null }
  }

  const fields = fieldsFor(featureKey)
  if (!fields) {
    return { allowed: true, used: 0, limit, resetAt: null }
  }

  const bucket = getDayBucketIL()
  const resetAt = getNextDayResetIsoIL()

  const user = await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
  })

  const userRecord = user as unknown as Record<string, unknown>
  const storedBucket = userRecord[fields.bucket] as string | undefined
  const storedUsed = userRecord[fields.used] as number | undefined
  const used = storedBucket === bucket ? (storedUsed ?? 0) : 0

  return { allowed: used < limit, used, limit, resetAt }
}
