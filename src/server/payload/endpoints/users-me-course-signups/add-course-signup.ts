/**
 * POST /api/users/me/course-signups
 *
 * Signs a student up for a course. Idempotent: repeating the call is a no-op.
 * Does not change `currentCourse` and does not grant access to the course.
 *
 * Body: { courseId: string, userId?: string (service token only) }
 * Response: 200 { success: true, data: { courseId, signedUp: true } }
 * Errors:
 *   400 — invalid body, unknown/unpublished course, ambiguous auth
 *   401 — unauthenticated
 *
 * @fileType api-route
 * @domain courses
 * @pattern self-write, dual-auth
 */
import {
  type CourseSignupRequest,
  findCourseSignup,
  resolveCourseSignupRequest,
} from './course-signup-request'

const signedUp = (courseId: string) =>
  Response.json({ success: true, data: { courseId, signedUp: true } })

export async function addCourseSignup(req: CourseSignupRequest) {
  const resolved = await resolveCourseSignupRequest(req)
  if (!resolved.ok) return resolved.response
  const { courseId, targetUserId } = resolved

  if (await findCourseSignup(req, targetUserId, courseId)) return signedUp(courseId)

  const course = await req.payload.findByID({
    collection: 'courses',
    id: courseId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  if (!course || course.status !== 'published' || !course.isActive) {
    return Response.json({ success: false, error: 'Course not found' }, { status: 400 })
  }

  try {
    await req.payload.create({
      collection: 'course-signups',
      data: { user: targetUserId, course: courseId },
      overrideAccess: true,
      depth: 0,
      req,
    })
  } catch (err) {
    // Two concurrent sign-ups: the unique index rejects the loser, which is
    // still a success for the caller.
    if (!(await findCourseSignup(req, targetUserId, courseId))) throw err
  }

  return signedUp(courseId)
}
