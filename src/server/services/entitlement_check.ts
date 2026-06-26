/**
 * Entitlement check service
 *
 * @fileType service
 * @domain entitlements
 * @ai-summary Checks if a user has access to a paid course via Enrollments collection (honoring expiresAt), with courseEntitlements fallback for backward compatibility
 */

import type { Payload } from 'payload'

interface CheckEntitlementParams {
  payload: Payload
  userId: string
  courseId: string
}

/**
 * Check if a user has an entitlement for a course.
 * Course entitlement covers all lessons in that course.
 *
 * Checks the Enrollments collection first (new system) with an `expiresAt`
 * filter so time-limited enrollments stop granting access past their
 * window. Missing `expiresAt` = lifetime access.
 *
 * Falls back to legacy `user.courseEntitlements` for backward compatibility
 * with grants written before the Enrollments-based system; emits a warning
 * so we can track when it's safe to remove the fallback.
 */
export async function hasEntitlement({
  payload,
  userId,
  courseId,
}: CheckEntitlementParams): Promise<boolean> {
  const nowIso = new Date().toISOString()

  // Step 1: Check Enrollments collection (active + not expired).
  // `expiresAt: { greater_than: now }` filters out expired records.
  // `{ exists: false }` lets lifetime enrollments through.
  const enrollment = await payload.find({
    collection: 'enrollments',
    where: {
      and: [
        { user: { equals: userId } },
        { course: { equals: courseId } },
        { status: { equals: 'active' } },
        {
          or: [{ expiresAt: { exists: false } }, { expiresAt: { greater_than: nowIso } }],
        },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (enrollment.docs.length > 0) {
    return true
  }

  // Step 2: Fallback to legacy courseEntitlements for backward compatibility.
  // Emits a warning to track when this path can be removed.
  const user = await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
    select: { courseEntitlements: true },
  })

  const entitlements = user?.courseEntitlements
  if (!entitlements || entitlements.length === 0) return false

  const match = entitlements.some((e) => {
    const entCourseId = typeof e.course === 'string' ? e.course : e.course?.id
    return entCourseId === courseId
  })

  if (match) {
    payload.logger.warn(
      { userId, courseId },
      'hasEntitlement: legacy user.courseEntitlements fallback granted access; consider migrating to Enrollments',
    )
  }

  return match
}
