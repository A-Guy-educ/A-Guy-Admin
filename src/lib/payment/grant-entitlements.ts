/**
 * Grant entitlements for a purchased product.
 *
 * Called by webhook handlers after payment success.
 * Idempotent on (user, course, transactionId): replayed webhooks do not
 * create duplicate Enrollments or duplicate featureEntitlements rows.
 *
 * @fileType utility
 * @domain payments
 * @pattern atomic-update, time-limited-access
 * @ai-summary Grants Enrollments + feature entitlements after successful payment by walking the Product.contents blocks
 */

import { ObjectId } from 'mongodb'
import { getPayload } from 'payload'

import config from '@payload-config'

type FeaturePeriod = 'day' | 'month' | 'lifetime'

interface FeatureGrant {
  key: string
  value: number | null
  period: FeaturePeriod
  expiresAt: string | null
}

interface CourseGrant {
  courseId: string
  expiresAt: string | null
}

interface CourseBlock {
  blockType: 'courseBlock'
  course: string | { id: string }
  lessonTypes?: string[] | null
}

interface FeatureBlock {
  blockType: 'featureBlock'
  feature: string | { id: string; key?: string; defaultPeriod?: string }
  limit?: number | null
  period?: string | null
}

type ProductContentBlock = CourseBlock | FeatureBlock

/**
 * Grant entitlements for a purchased product.
 *
 * Flow:
 * 1. Fetch the Product with `contents` blocks populated (depth=2 so the
 *    feature relationship inside featureBlock is resolved to {id, key}).
 * 2. Compute `expiresAt = now + product.durationDays` (or null for lifetime).
 * 3. For each block:
 *    - courseBlock → upsert Enrollment for (user, course)
 *    - featureBlock → resolve feature key, atomic $push featureEntitlements
 *      with limit/period/expiresAt
 * 4. Idempotency: Enrollments use a (user, course) unique index +
 *    `metadata.paymentId = transactionId`; featureEntitlements use a
 *    `transactionId + key` $not $elemMatch guard so replayed webhooks no-op.
 */
/**
 * Sentinel for grantProductEntitlements' `expiresAtOverride` parameter meaning
 * "compute expiry from product.durationDays" (the one-time-purchase default).
 * Callers with an explicit expiry (subscriptions) pass an ISO string instead.
 *
 * Using a string sentinel — as opposed to `undefined` or an options-bag `in`
 * check — closes a footgun where a caller chaining `x ?? undefined` could
 * silently land in the override branch with an undefined value and produce
 * a lifetime grant instead of the intended durationDays fallback.
 */
export const INHERIT_EXPIRY = 'inherit' as const

export async function grantProductEntitlements(
  userId: string,
  productId: string,
  transactionId: string,
  expiresAtOverride: string | typeof INHERIT_EXPIRY = INHERIT_EXPIRY,
): Promise<void> {
  const payload = await getPayload({ config })

  const product = await payload.findByID({
    collection: 'products',
    id: productId,
    depth: 2,
    overrideAccess: true,
  })

  if (!product) {
    throw new Error(`Product not found: ${productId}`)
  }

  const durationDays =
    typeof (product as { durationDays?: unknown }).durationDays === 'number'
      ? (product as { durationDays: number }).durationDays
      : null
  const now = new Date()
  // `expiresAtOverride === INHERIT_EXPIRY` → fall back to durationDays.
  // Any other string → use it directly as the ISO expiry.
  const expiresAt: string | null =
    expiresAtOverride !== INHERIT_EXPIRY
      ? expiresAtOverride
      : durationDays && durationDays > 0
        ? new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString()
        : null

  const blocks =
    ((product as { contents?: unknown }).contents as ProductContentBlock[] | undefined) ?? []
  if (blocks.length === 0) return

  const courseGrants: CourseGrant[] = []
  const featureGrants: FeatureGrant[] = []

  for (const block of blocks) {
    if (block.blockType === 'courseBlock') {
      if (!block.course) {
        payload.logger.warn(
          { productId, transactionId },
          'grantProductEntitlements: courseBlock has no course relationship; skipping',
        )
        continue
      }
      const courseId = typeof block.course === 'string' ? block.course : block.course.id
      courseGrants.push({ courseId, expiresAt })
    } else if (block.blockType === 'featureBlock') {
      if (!block.feature) {
        payload.logger.warn(
          { productId, transactionId },
          'grantProductEntitlements: featureBlock has no feature relationship; skipping',
        )
        continue
      }
      // Resolve the feature key. With depth >= 1 the relationship is populated
      // as an object with a `key` field; fall back to a separate read when only
      // the id is available.
      let key: string | null = null
      let defaultPeriod: string | null = null
      if (typeof block.feature === 'object') {
        key = typeof block.feature.key === 'string' ? block.feature.key : null
        defaultPeriod =
          typeof block.feature.defaultPeriod === 'string' ? block.feature.defaultPeriod : null
      }
      if (!key) {
        const featureId = typeof block.feature === 'string' ? block.feature : block.feature.id
        try {
          const featureDoc = await payload.findByID({
            collection: 'features',
            id: featureId,
            depth: 0,
            overrideAccess: true,
          })
          key = (featureDoc as { key?: string }).key ?? null
          defaultPeriod = (featureDoc as { defaultPeriod?: string }).defaultPeriod ?? null
        } catch (error) {
          payload.logger.warn(
            { err: error, featureId, productId, transactionId },
            'grantProductEntitlements: featureBlock points at a missing Feature; skipping',
          )
          continue
        }
      }
      if (!key) continue

      // Period fallback ladder: block override → feature defaultPeriod →
      // 'lifetime'. The schema's defaultValue: 'day' on the block means new
      // products always supply a valid period, so the 'lifetime' tail is
      // only reachable via API/manual writes with an unknown period string.
      // The combination (numeric limit + period='lifetime') would collapse
      // to "unlimited" at feature-quota.ts; the Products beforeValidate hook
      // rejects numeric featureBlocks without a limit, which keeps that
      // pathway closed for admin-driven writes.
      const blockPeriod = block.period
      const resolvedPeriod: FeaturePeriod =
        blockPeriod === 'day' || blockPeriod === 'month' || blockPeriod === 'lifetime'
          ? blockPeriod
          : defaultPeriod === 'day' || defaultPeriod === 'month' || defaultPeriod === 'lifetime'
            ? defaultPeriod
            : 'lifetime'

      const value = typeof block.limit === 'number' ? block.limit : null

      featureGrants.push({
        key,
        value,
        period: resolvedPeriod,
        expiresAt,
      })
    }
  }

  for (const grant of courseGrants) {
    await upsertEnrollment(payload, userId, grant.courseId, grant.expiresAt, transactionId)
  }

  if (featureGrants.length > 0) {
    await pushFeatureEntitlements(payload, userId, featureGrants, transactionId)
  }
}

/**
 * Upsert an Enrollment for (user, course). Idempotency + concurrency:
 * - The Enrollments collection has a `{ user, course } unique` index. We
 *   try a create first; if it throws, we re-find — if a matching row
 *   exists, treat it as a race/replay and fall through to the update
 *   branch; otherwise rethrow the original error.
 *
 *   We can't reliably pattern-match the underlying E11000 because Payload's
 *   mongo adapter translates duplicate-key errors on unique indexes into a
 *   ValidationError citing the first field in the index (e.g. "user
 *   invalid"). The re-find approach is robust regardless of how the error
 *   surfaces.
 *
 * - On update we only refresh state when the existing record was granted by
 *   a different transaction, so true replays of the same tx are no-ops.
 * - On a lifetime re-purchase we explicitly clear expiresAt. `hasEntitlement`
 *   accepts both `exists: false` and `equals: null` to handle this.
 * - Prior metadata (accessCodeId, grantedBy from a previous admin/code grant)
 *   is preserved by merging rather than replacing the metadata group.
 */
async function upsertEnrollment(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  courseId: string,
  expiresAt: string | null,
  transactionId: string,
): Promise<void> {
  try {
    await payload.create({
      collection: 'enrollments',
      data: {
        user: userId,
        course: courseId,
        status: 'active',
        grantMethod: 'payment',
        source: 'api',
        enrolledAt: new Date().toISOString(),
        ...(expiresAt ? { expiresAt } : {}),
        metadata: { paymentId: transactionId },
      },
      overrideAccess: true,
    })
    return
  } catch (createError) {
    const recheck = await payload.find({
      collection: 'enrollments',
      where: {
        and: [{ user: { equals: userId } }, { course: { equals: courseId } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (recheck.docs.length === 0) throw createError

    const current = recheck.docs[0] as {
      id: string
      status: string
      metadata?: { paymentId?: string; accessCodeId?: string; grantedBy?: string }
    }

    return performEnrollmentUpdate(payload, current, expiresAt, transactionId)
  }
}

async function performEnrollmentUpdate(
  payload: Awaited<ReturnType<typeof getPayload>>,
  current: {
    id: string
    status: string
    metadata?: { paymentId?: string; accessCodeId?: string; grantedBy?: string }
  },
  expiresAt: string | null,
  transactionId: string,
): Promise<void> {
  if (current.metadata?.paymentId === transactionId && current.status === 'active') {
    return
  }
  await payload.update({
    collection: 'enrollments',
    id: current.id,
    data: {
      status: 'active',
      grantMethod: 'payment',
      expiresAt: expiresAt ?? null,
      cancelledAt: null,
      metadata: {
        ...(current.metadata ?? {}),
        paymentId: transactionId,
      },
    },
    overrideAccess: true,
  })
}

/**
 * Extend entitlements for a subscription renewal. Called on
 * PAYMENT.SALE.COMPLETED events driven by PayPal recurring billing.
 *
 * Anchor semantics: each Enrollment's `expiresAt` is pushed forward by
 * `intervalMonths` from its CURRENT value — not from `Date.now()`. A late
 * webhook (delivered days after the renewal actually processed) should not
 * shorten the user's access window.
 *
 * If an Enrollment has `expiresAt = null` (lifetime), we leave it alone.
 *
 * Idempotency: skipped if the Enrollment's `metadata.paymentId` already
 * equals `transactionId` (replay of the same PAYMENT.SALE.COMPLETED).
 *
 * Feature entitlements are re-pushed under the new `transactionId` so that
 * revoking a specific renewal (or the whole sub) surgically removes just
 * the affected grants via the existing `revokeProductEntitlements` code.
 */
export async function extendProductEntitlements(
  userId: string,
  productId: string,
  transactionId: string,
  intervalMonths: number,
): Promise<{ maxEnrollmentEndMs: number }> {
  const payload = await getPayload({ config })

  // Downgraded from throw to warn+return: a bad intervalMonths is a config
  // error we cannot self-heal, and throwing would return 500 to PayPal,
  // triggering infinite webhook retries.
  if (intervalMonths <= 0) {
    payload.logger.warn(
      { userId, productId, transactionId, intervalMonths },
      'extendProductEntitlements: intervalMonths must be positive — skipping',
    )
    return { maxEnrollmentEndMs: 0 }
  }

  const product = await payload.findByID({
    collection: 'products',
    id: productId,
    depth: 2,
    overrideAccess: true,
  })
  if (!product) throw new Error(`Product not found: ${productId}`)

  const blocks =
    ((product as { contents?: unknown }).contents as ProductContentBlock[] | undefined) ?? []
  if (blocks.length === 0) return { maxEnrollmentEndMs: 0 }

  // Extend Enrollments for every courseBlock, tracking the maximum resulting
  // expiresAt so feature entitlements can anchor on the same reference point.
  // Without this, features would anchor on `now + intervalMonths` while
  // enrollments anchor on `max(current, now) + intervalMonths` — a late
  // webhook would leave features expiring earlier than enrollments for the
  // same purchase, and the drift compounds over renewals.
  let maxEnrollmentEndMs = 0
  for (const block of blocks) {
    if (block.blockType !== 'courseBlock' || !block.course) continue
    const courseId = typeof block.course === 'string' ? block.course : block.course.id
    const newEndMs = await extendEnrollment(payload, userId, courseId, intervalMonths, transactionId)
    if (newEndMs !== null) {
      maxEnrollmentEndMs = Math.max(maxEnrollmentEndMs, newEndMs)
    }
  }

  // Feature grants anchor on the LATEST enrollment expiry produced by this
  // renewal (or `now + intervalMonths` for pure-feature products with no
  // courseBlocks). `pushFeatureEntitlements` is guarded by (transactionId,
  // key) so a replay of the same sale is a no-op.
  const featureGrants: FeatureGrant[] = []
  const periodEndIso =
    maxEnrollmentEndMs > 0
      ? new Date(maxEnrollmentEndMs).toISOString()
      : addCalendarMonths(new Date(), intervalMonths).toISOString()

  for (const block of blocks) {
    if (block.blockType !== 'featureBlock' || !block.feature) continue
    let key: string | null = null
    let defaultPeriod: string | null = null
    if (typeof block.feature === 'object') {
      key = typeof block.feature.key === 'string' ? block.feature.key : null
      defaultPeriod =
        typeof block.feature.defaultPeriod === 'string' ? block.feature.defaultPeriod : null
    }
    if (!key) {
      const featureId = typeof block.feature === 'string' ? block.feature : block.feature.id
      try {
        const featureDoc = await payload.findByID({
          collection: 'features',
          id: featureId,
          depth: 0,
          overrideAccess: true,
        })
        key = (featureDoc as { key?: string }).key ?? null
        defaultPeriod = (featureDoc as { defaultPeriod?: string }).defaultPeriod ?? null
      } catch {
        continue
      }
    }
    if (!key) continue

    const blockPeriod = block.period
    const resolvedPeriod: FeaturePeriod =
      blockPeriod === 'day' || blockPeriod === 'month' || blockPeriod === 'lifetime'
        ? blockPeriod
        : defaultPeriod === 'day' || defaultPeriod === 'month' || defaultPeriod === 'lifetime'
          ? defaultPeriod
          : 'lifetime'

    featureGrants.push({
      key,
      value: typeof block.limit === 'number' ? block.limit : null,
      period: resolvedPeriod,
      expiresAt: periodEndIso,
    })
  }

  if (featureGrants.length > 0) {
    await pushFeatureEntitlements(payload, userId, featureGrants, transactionId)
  }

  return { maxEnrollmentEndMs }
}

/**
 * Extend an Enrollment. Returns the new expiresAt in ms (used by the caller
 * to compute a shared feature-grant anchor across the whole product), or
 * `null` for lifetime enrollments where there's nothing to extend.
 */
async function extendEnrollment(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  courseId: string,
  intervalMonths: number,
  transactionId: string,
): Promise<number | null> {
  const existing = await payload.find({
    collection: 'enrollments',
    where: { and: [{ user: { equals: userId } }, { course: { equals: courseId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.docs.length === 0) {
    // No existing enrollment — fresh grant with expiry anchored at now.
    const expiresAt = addCalendarMonths(new Date(), intervalMonths)
    await upsertEnrollment(payload, userId, courseId, expiresAt.toISOString(), transactionId)
    return expiresAt.getTime()
  }

  const current = existing.docs[0] as {
    id: string
    status: string
    expiresAt?: string | null
    metadata?: { paymentId?: string; accessCodeId?: string; grantedBy?: string }
  }

  // Idempotent replay
  if (current.metadata?.paymentId === transactionId && current.status === 'active') {
    return current.expiresAt ? new Date(current.expiresAt).getTime() : null
  }

  // Lifetime enrollment — no expiresAt to extend, but STILL rotate paymentId
  // so revoke against the latest paying transaction works. Without this
  // rotation, EXPIRED webhooks after any renewal fail to match the enrollment
  // (its paymentId stays pinned to the initial transaction while the revoke
  // path targets the latest renewal).
  if (!current.expiresAt) {
    await payload.update({
      collection: 'enrollments',
      id: current.id,
      data: {
        status: 'active',
        grantMethod: 'payment',
        cancelledAt: null,
        metadata: {
          ...(current.metadata ?? {}),
          paymentId: transactionId,
        },
      },
      overrideAccess: true,
    })
    return null
  }

  // Anchor on the LATER of {current expiresAt, now} so a long-expired sub
  // that reactivates doesn't grant a period ending in the past.
  const anchor = new Date(current.expiresAt).getTime()
  const baseDate = new Date(Math.max(anchor, Date.now()))
  const extendedDate = addCalendarMonths(baseDate, intervalMonths)

  await payload.update({
    collection: 'enrollments',
    id: current.id,
    data: {
      status: 'active',
      grantMethod: 'payment',
      expiresAt: extendedDate.toISOString(),
      cancelledAt: null,
      metadata: {
        ...(current.metadata ?? {}),
        paymentId: transactionId,
      },
    },
    overrideAccess: true,
  })

  return extendedDate.getTime()
}

/**
 * Calendar-aware month arithmetic. `d.setMonth(d.getMonth() + n)` handles
 * variable month lengths correctly (Feb, 30/31-day months, leap years)
 * where fixed 30-day math drifts ~5 days/year on annual plans.
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

/**
 * Atomic $push of feature entitlements, one per grant. Each push is guarded
 * by `{ transactionId, key } $not $elemMatch` so a webhook replay can't
 * create duplicates for the same (key, transactionId) pair.
 *
 * Intent on cross-product duplicates: a user who buys product A granting
 * `ai-questions=5/day` and product B granting `ai-questions=10/day` ends up
 * with TWO rows under the same key. This is deliberate so each row stays
 * tied to its source transaction (revoke-on-refund can surgically remove
 * just the affected grant). The rate-limit consumer (feature-quota.ts) is
 * responsible for picking which row's `value`/`period` to apply when
 * multiple non-expired entries share a key — current intent is "latest
 * non-expired grant by grantedAt wins".
 */
async function pushFeatureEntitlements(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  grants: FeatureGrant[],
  transactionId: string,
): Promise<void> {
  const usersCollection = payload.db.collections['users']
  const userObjectId = new ObjectId(userId)

  for (const grant of grants) {
    await usersCollection.updateOne(
      {
        _id: userObjectId,
        featureEntitlements: {
          $not: {
            $elemMatch: { key: grant.key, transactionId },
          },
        },
      },
      {
        $push: {
          featureEntitlements: {
            _id: new ObjectId(),
            key: grant.key,
            value: grant.value,
            period: grant.period,
            expiresAt: grant.expiresAt,
            transactionId,
            grantedAt: new Date().toISOString(),
          },
        },
      },
    )
  }
}
