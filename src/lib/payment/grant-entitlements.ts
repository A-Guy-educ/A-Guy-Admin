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
 * @ai-summary Grants Enrollments + feature entitlements after successful payment, applying product.durationDays as expiresAt
 */

import { ObjectId } from 'mongodb'
import { getPayload } from 'payload'

import config from '@payload-config'
import type { FeatureKey } from '@/lib/products/feature-keys'

type FeaturePeriod = 'day' | 'month' | 'lifetime'

interface FeatureGrant {
  key: FeatureKey
  value: number | null
  period: FeaturePeriod
  expiresAt: string | null
}

interface CourseGrant {
  courseId: string
  expiresAt: string | null
}

/**
 * Grant entitlements for a purchased product.
 *
 * Flow:
 * 1. Fetch the Product with items populated.
 * 2. Compute `expiresAt = now + product.durationDays` (or null for lifetime).
 * 3. For each ProductItem:
 *    - type='course' → upsert Enrollment for (user, course)
 *    - type='lesson' → resolve lesson.chapter.course, upsert Enrollment for that course
 *    - type='feature' → atomic $push featureEntitlements with value/period/expiresAt
 * 4. Idempotency: Enrollments use a (user, course) unique index +
 *    `metadata.paymentId = transactionId`; featureEntitlements use a
 *    `transactionId + key` $ne guard so replayed webhooks no-op.
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
    depth: 1,
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

  const itemIds: string[] = []
  if (product.items && Array.isArray(product.items)) {
    for (const item of product.items) {
      const itemId = typeof item === 'string' ? item : item.id
      if (itemId) itemIds.push(itemId)
    }
  }
  if (itemIds.length === 0) return

  const items = await payload.find({
    collection: 'product-items',
    where: { id: { in: itemIds } },
    depth: 0,
    limit: 100,
    overrideAccess: true,
  })

  const courseGrants: CourseGrant[] = []
  const featureGrants: FeatureGrant[] = []

  for (const item of items.docs) {
    if (item.type === 'course') {
      if (!item.course) {
        payload.logger.warn(
          { productId, transactionId, productItemId: item.id },
          'grantProductEntitlements: course-type ProductItem has no course relationship; skipping',
        )
        continue
      }
      const courseId = typeof item.course === 'string' ? item.course : item.course.id
      courseGrants.push({ courseId, expiresAt })
    } else if (item.type === 'lesson' && item.lesson) {
      // Resolve lesson → parent course. Lessons have an auto-populated `course`
      // field (Lessons.ts), but fall back to chapter.course if missing.
      const lessonId = typeof item.lesson === 'string' ? item.lesson : item.lesson.id
      const { courseId, error } = await resolveLessonCourseId(payload, lessonId)
      if (!courseId) {
        payload.logger.warn(
          { lessonId, productId, transactionId, productItemId: item.id, err: error },
          'grantProductEntitlements: lesson has no resolvable course; skipping',
        )
        continue
      }
      courseGrants.push({ courseId, expiresAt })
    } else if (item.type === 'feature' && item.featureKey) {
      const rawPeriod = (item as { period?: unknown }).period
      const period: FeaturePeriod =
        rawPeriod === 'day' || rawPeriod === 'month' || rawPeriod === 'lifetime'
          ? rawPeriod
          : 'lifetime'
      const rawValue = (item as { value?: unknown }).value
      const value = typeof rawValue === 'number' ? rawValue : null
      featureGrants.push({
        key: item.featureKey as FeatureKey,
        value,
        period,
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

async function resolveLessonCourseId(
  payload: Awaited<ReturnType<typeof getPayload>>,
  lessonId: string,
): Promise<{ courseId: string | null; error: unknown | null }> {
  try {
    const lesson = await payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 1,
      overrideAccess: true,
    })
    if (lesson?.course) {
      return {
        courseId: typeof lesson.course === 'string' ? lesson.course : lesson.course.id,
        error: null,
      }
    }
    // Fallback: chapter.course
    if (lesson?.chapter && typeof lesson.chapter === 'object' && 'course' in lesson.chapter) {
      const chapterCourse = (lesson.chapter as { course?: string | { id: string } }).course
      if (chapterCourse) {
        return {
          courseId: typeof chapterCourse === 'string' ? chapterCourse : chapterCourse.id,
          error: null,
        }
      }
    }
    return { courseId: null, error: null }
  } catch (error) {
    return { courseId: null, error }
  }
}

/**
 * Upsert an Enrollment for (user, course). Idempotency + concurrency:
 * - The Enrollments collection has a `{ user, course } unique` index. We
 *   try a create first; on duplicate-key error (concurrent webhook delivery
 *   or true replay) we re-find and fall through to the update branch.
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
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    // Fall through to the update branch — another concurrent webhook (or a
    // prior grant for this user+course) won the create race.
  }

  const existing = await payload.find({
    collection: 'enrollments',
    where: {
      and: [{ user: { equals: userId } }, { course: { equals: courseId } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.docs.length === 0) {
    // Shouldn't happen if we just hit a duplicate-key error, but bail safely.
    return
  }

  const current = existing.docs[0] as {
    id: string
    status: string
    metadata?: { paymentId?: string; accessCodeId?: string; grantedBy?: string }
  }

  // Same transaction replay → no-op.
  if (current.metadata?.paymentId === transactionId && current.status === 'active') {
    return
  }

  // Different transaction (re-purchase after expiry/refund, or upgrade from
  // an admin/code grant) → refresh state. Preserve prior metadata fields
  // (accessCodeId, grantedBy) so audit history isn't clobbered.
  await payload.update({
    collection: 'enrollments',
    id: current.id,
    data: {
      status: 'active',
      grantMethod: 'payment',
      enrolledAt: new Date().toISOString(),
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
 * MongoDB duplicate-key errors come through as `code === 11000`. Payload may
 * wrap them, so we also check the message.
 */
function isDuplicateKeyError(error: unknown): boolean {
  if (!error) return false
  const err = error as { code?: number; message?: string; cause?: { code?: number } }
  if (err.code === 11000) return true
  if (err.cause?.code === 11000) return true
  if (typeof err.message === 'string' && /E11000|duplicate key/i.test(err.message)) return true
  return false
}

/**
 * Atomic $push of feature entitlements, one per grant. Each push is guarded
 * by `{ transactionId, key } $not $elemMatch` so a webhook replay can't
 * create duplicates for the same (key, transactionId) pair.
 *
 * Intent on cross-product duplicates: a user who buys product A granting
 * `ai-questions=5/day` (tx1) and product B granting `ai-questions=10/day`
 * (tx2) ends up with TWO rows under the same key. This is deliberate so
 * each row stays tied to its source transaction (revoke-on-refund can
 * surgically remove just the affected grant). The rate-limit consumer
 * (Task C, #76) is responsible for picking which row's `value`/`period`
 * to apply when multiple non-expired entries share a key — current intent
 * is "latest non-expired grant by grantedAt wins".
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
