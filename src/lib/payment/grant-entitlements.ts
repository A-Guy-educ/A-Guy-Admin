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
export async function grantProductEntitlements(
  userId: string,
  productId: string,
  transactionId: string,
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
  const expiresAt =
    durationDays && durationDays > 0
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
