/**
 * Shared request handling for POST/DELETE /api/users/me/course-signups.
 *
 * Auth rules are the same as course-state (see `resolve-auth.ts`): a cookie
 * session writes to itself; a service token must name `userId` in the body.
 *
 * @fileType utility
 * @domain courses
 * @pattern dual-auth
 */
import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { resolveCourseStateAuth } from '@/server/payload/endpoints/users-me-course-state/resolve-auth'

export type CourseSignupRequest = PayloadRequest & { json?: () => Promise<unknown> }

type ResolvedRequest =
  | { ok: true; courseId: string; targetUserId: string }
  | { ok: false; response: Response }

const requestSchema = z.object({
  courseId: z.string().min(1),
  userId: z.string().min(1).optional(),
})

export async function resolveCourseSignupRequest(
  req: CourseSignupRequest,
): Promise<ResolvedRequest> {
  let body: unknown
  try {
    body = req.json ? await req.json() : null
  } catch {
    return {
      ok: false,
      response: Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }),
    }
  }

  const parsed = requestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      ),
    }
  }

  const auth = resolveCourseStateAuth(req, parsed.data.userId)
  if (!auth.ok) {
    return {
      ok: false,
      response: Response.json({ success: false, error: auth.error }, { status: auth.status }),
    }
  }

  return { ok: true, courseId: parsed.data.courseId, targetUserId: auth.targetUserId }
}

export async function findCourseSignup(req: CourseSignupRequest, userId: string, courseId: string) {
  const { docs } = await req.payload.find({
    collection: 'course-signups',
    where: { and: [{ user: { equals: userId } }, { course: { equals: courseId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return docs[0] ?? null
}
