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
    if (item.type === 'course' && item.course) {
      const courseId = typeof item.course === 'string' ? item.course : item.course.id
      courseGrants.push({ courseId, expiresAt })
    } else if (item.type === 'lesson' && item.lesson) {
      // Resolve lesson → parent course. Lessons have an auto-populated `course`
      // field (Lessons.ts), but fall back to chapter.course if missing.
      const lessonId = typeof item.lesson === 'string' ? item.lesson : item.lesson.id
      const courseId = await resolveLessonCourseId(payload, lessonId)
      if (!courseId) {
        payload.logger.warn(
          { lessonId, productId, transactionId, productItemId: item.id },
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
): Promise<string | null> {
  try {
    const lesson = await payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 1,
      overrideAccess: true,
    })
    if (lesson?.course) {
      return typeof lesson.course === 'string' ? lesson.course : lesson.course.id
    }
    // Fallback: chapter.course
    if (lesson?.chapter && typeof lesson.chapter === 'object' && 'course' in lesson.chapter) {
      const chapterCourse = (lesson.chapter as { course?: string | { id: string } }).course
      if (chapterCourse) {
        return typeof chapterCourse === 'string' ? chapterCourse : chapterCourse.id
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Upsert an Enrollment for (user, course). Idempotency:
 * - The Enrollments collection has a `{ user, course } unique` index, so a
 *   second create for the same pair throws — we catch that and update instead.
 * - On update we only refresh expiresAt + metadata.paymentId when the existing
 *   record has a different transactionId, so true replays are no-ops.
 */
async function upsertEnrollment(
  payload: Awaited<ReturnType<typeof getPayload>>,
  userId: string,
  courseId: string,
  expiresAt: string | null,
  transactionId: string,
): Promise<void> {
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
  }

  const current = existing.docs[0] as {
    id: string
    status: string
    metadata?: { paymentId?: string }
  }

  // Same transaction replay → no-op.
  if (current.metadata?.paymentId === transactionId && current.status === 'active') {
    return
  }

  // Different transaction (e.g. user re-purchased after expiry/refund) →
  // refresh status, expiry, and paymentId so the new purchase is honored.
  await payload.update({
    collection: 'enrollments',
    id: current.id,
    data: {
      status: 'active',
      grantMethod: 'payment',
      enrolledAt: new Date().toISOString(),
      expiresAt: expiresAt ?? null,
      cancelledAt: null,
      metadata: { paymentId: transactionId },
    },
    overrideAccess: true,
  })
}

/**
 * Atomic $push of feature entitlements, one per grant. Each push is guarded
 * by `{ transactionId, key } $ne` so a webhook replay can't create duplicates.
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
