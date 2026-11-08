/**
 * DELETE /api/users/me/course-signups
 *
 * Removes a student's sign-up for a course. Idempotent: removing a sign-up
 * that does not exist still succeeds. Leaves `currentCourse`, enrollments and
 * progress untouched.
 *
 * Body: { courseId: string, userId?: string (service token only) }
 * Response: 200 { success: true, data: { courseId, signedUp: false } }
 * Errors:
 *   400 — invalid body, ambiguous auth
 *   401 — unauthenticated
 *
 * @fileType api-route
 * @domain courses
 * @pattern self-write, dual-auth
 */
import { type CourseSignupRequest, resolveCourseSignupRequest } from './course-signup-request'

export async function removeCourseSignup(req: CourseSignupRequest) {
  const resolved = await resolveCourseSignupRequest(req)
  if (!resolved.ok) return resolved.response
  const { courseId, targetUserId } = resolved

  await req.payload.delete({
    collection: 'course-signups',
    where: { and: [{ user: { equals: targetUserId } }, { course: { equals: courseId } }] },
    overrideAccess: true,
    req,
  })

  return Response.json({ success: true, data: { courseId, signedUp: false } })
}
