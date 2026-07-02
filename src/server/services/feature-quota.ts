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

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

import { getUsersMongoCollection } from './internal/users-mongo-collection'

/**
 * Feature keys are dynamic (DB-backed in the Features collection), so this is
 * just `string` at the type level. Runtime callers pass a key looked up from
 * a feature relationship.
 */
type FeatureKeyString = string

export type FeaturePeriod = 'day' | 'month' | 'lifetime'

export interface FeatureEntitlement {
  key: FeatureKeyString
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

// Cached formatter — single allocation per process, ~10x cheaper than
// constructing a new Intl.DateTimeFormat per call. DST is handled by the
// timeZone option, so the offset adjusts automatically across spring/fall.
const IL_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: IL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * Returns IL-local calendar parts {year, month, day, hour, minute, second}
 * for a given Date. The numeric parts let us construct tomorrow's IL midnight
 * directly without walking the clock back minute-by-minute.
 */
function getILParts(date: Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const parts = IL_PARTS_FORMATTER.formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * Next Asia/Jerusalem midnight as an ISO string. Tells clients exactly when
 * the counter will reset. DST-correct: we derive IL-local parts via Intl,
 * advance the date by one IL-day, then find the UTC instant whose IL parts
 * equal {tomorrow, 00:00:00}.
 */
export function getNextDayResetIsoIL(date: Date = new Date()): string {
  const il = getILParts(date)
  // Approximate UTC for tomorrow IL midnight by treating IL as UTC+3
  // (summer DST). Then correct by the actual IL/UTC offset measured against
  // the candidate's own IL parts. One Intl call per correction iteration —
  // converges in at most two iterations (DST transitions move the wall
  // clock by at most one hour, never more than once in a 24h window).
  let candidate = Date.UTC(il.year, il.month - 1, il.day + 1, 0, 0, 0) - 3 * 60 * 60 * 1000
  for (let i = 0; i < 3; i++) {
    const cParts = getILParts(new Date(candidate))
    if (cParts.hour === 0 && cParts.minute === 0 && cParts.second === 0) break
    // Correction: the candidate's IL hour/minute tell us by how much we
    // overshot or undershot. Adjust by that delta.
    const drift = ((cParts.hour * 60 + cParts.minute) * 60 + cParts.second) * 1000
    // If we're past midnight (hour 0–11), drift is positive; subtract it.
    // If we're before midnight (hour 12–23), we need to advance by (24h - drift).
    if (cParts.hour < 12) {
      candidate -= drift
    } else {
      candidate += 24 * 60 * 60 * 1000 - drift
    }
  }
  return new Date(candidate).toISOString()
}

/**
 * Returns the best matching non-expired featureEntitlement for a given key.
 * Per the documented intent in grant-entitlements.ts, when multiple rows
 * exist for the same key (cross-product bundles) the latest by grantedAt
 * wins (transactionId is the deterministic tiebreaker).
 *
 * For callers that need both the entitlement AND will later read other
 * fields off the same user document, use `resolveFeatureEntitlementWithUser`
 * to amortize the findByID across both reads.
 */
export async function resolveFeatureEntitlement(
  payload: Payload,
  userId: string,
  featureKey: FeatureKeyString,
): Promise<FeatureEntitlement | null> {
  const { entitlement } = await resolveFeatureEntitlementWithUser(payload, userId, featureKey)
  return entitlement
}

/**
 * Same as `resolveFeatureEntitlement` but also returns the raw user record
 * for downstream callers (e.g. `getFeatureQuotaStatus`) that would
 * otherwise re-read the same document.
 */
export async function resolveFeatureEntitlementWithUser(
  payload: Payload,
  userId: string,
  featureKey: FeatureKeyString,
): Promise<{ entitlement: FeatureEntitlement | null; user: Record<string, unknown> }> {
  const user = (await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>

  return { entitlement: pickEntitlementFromUser(user, featureKey), user }
}

/**
 * Pure entitlement-picker that operates on an already-loaded user record.
 * Callers that resolve multiple feature keys for the same user (e.g. the
 * chat-quota hot path checking both `chat-limit` and `ai-questions`) should
 * load the user once with `resolveFeatureEntitlementWithUser` and pick
 * additional keys via this helper to avoid N extra findByID round-trips.
 */
export function pickEntitlementFromUser(
  user: Record<string, unknown>,
  featureKey: FeatureKeyString,
): FeatureEntitlement | null {
  const rawEntitlements =
    (user.featureEntitlements as Array<Record<string, unknown>> | undefined) ?? []

  const now = Date.now()
  const matching: FeatureEntitlement[] = rawEntitlements
    .filter((e) => e.key === featureKey)
    .map((e) => ({
      key: e.key as FeatureKeyString,
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

  // Latest non-expired grant by grantedAt wins; ties broken deterministically
  // by transactionId (descending) so seeds/tests with identical timestamps
  // don't depend on JS sort stability.
  matching.sort((a, b) => {
    const aMs = a.grantedAt ? new Date(a.grantedAt).getTime() : 0
    const bMs = b.grantedAt ? new Date(b.grantedAt).getTime() : 0
    if (aMs !== bMs) return bMs - aMs
    return (b.transactionId ?? '').localeCompare(a.transactionId ?? '')
  })
  return matching[0]
}

interface FeatureQuotaFieldNames {
  used: string
  bucket: string
}

const FIELD_NAMES: Record<string, FeatureQuotaFieldNames> = {
  'ai-questions': { used: 'aiQuestionsUsedDay', bucket: 'aiQuestionsBucketDay' },
  'chat-limit': { used: 'chatLimitUsedDay', bucket: 'chatLimitBucketDay' },
}

function fieldsFor(featureKey: FeatureKeyString): FeatureQuotaFieldNames | null {
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
  featureKey: FeatureKeyString,
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

  // Zero-limit guard: a "0/day" cap must deny every request. Without this
  // short-circuit, Step 2 (bucket missing/stale) would set used=1 on the
  // first request of the day and incorrectly return allowed=true.
  if (limit <= 0) {
    return { allowed: false, used: 0, limit, resetAt: getNextDayResetIsoIL() }
  }

  const fields = fieldsFor(featureKey)
  if (!fields) {
    // No counter wired for this key. Per-day cap configured for a feature
    // we can't actually enforce — log loudly so ops notice. Fail open: allow.
    payload.logger.warn(
      { userId, featureKey, limit, period: entitlement.period },
      'feature-quota: per-day cap configured for a key with no counter mapping; allowing request',
    )
    return { allowed: true, used: 0, limit, resetAt: null }
  }

  const collection = getUsersMongoCollection(payload)
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

  // Step 3: Step 2 missed. Two possibilities:
  //   (a) Genuinely at limit in today's bucket — deny.
  //   (b) Race at the IL day transition: another request just won Step 2
  //       and reset the bucket to today, so this request's Step 2 missed
  //       because bucket is no longer != today. Re-run Step 1: if bucket
  //       now matches and used < limit, this is request #2 of a brand-new
  //       day and should pass.
  const retryInc = await collection.findOneAndUpdate(
    {
      _id: userObjectId,
      [fields.bucket]: bucket,
      [fields.used]: { $lt: limit },
    },
    { $inc: { [fields.used]: 1 } },
    { returnDocument: 'after' },
  )
  if (retryInc) {
    return {
      allowed: true,
      used: (retryInc[fields.used] as number) ?? 1,
      limit,
      resetAt,
    }
  }

  // Truly at limit in today's bucket.
  return { allowed: false, used: limit, limit, resetAt }
}

/**
 * Atomically decrement the per-day counter for a feature, used to compensate
 * for an already-charged ai-questions increment when a subsequent silent
 * chat-limit cap denies the request. Best-effort: clamps at 0 (`{ used: { $gt: 0 } }`)
 * and is a no-op when no counter mapping exists.
 */
export async function decrementFeatureQuota(
  payload: Payload,
  userId: string,
  featureKey: FeatureKeyString,
): Promise<void> {
  const fields = fieldsFor(featureKey)
  if (!fields) return
  const collection = getUsersMongoCollection(payload)
  if (!collection) return
  await collection.updateOne(
    { _id: new ObjectId(userId), [fields.used]: { $gt: 0 } },
    { $inc: { [fields.used]: -1 } },
  )
}

/**
 * Read-only quota status — does not increment. Used by the chat-quota
 * endpoint to surface remaining count + resetAt to clients.
 *
 * Accepts an optional `preloadedUser` so callers that already read the
 * user document (e.g. from a prior `resolveFeatureEntitlement` call) can
 * pass it through instead of paying for a second findByID.
 */
export async function getFeatureQuotaStatus(
  payload: Payload,
  userId: string,
  featureKey: FeatureKeyString,
  entitlement: FeatureEntitlement,
  preloadedUser?: Record<string, unknown>,
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

  const userRecord =
    preloadedUser ??
    ((await payload.findByID({
      collection: 'users',
      id: userId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>)
  const storedBucket = userRecord[fields.bucket] as string | undefined
  const storedUsed = userRecord[fields.used] as number | undefined
  const used = storedBucket === bucket ? (storedUsed ?? 0) : 0

  return { allowed: used < limit, used, limit, resetAt }
}
