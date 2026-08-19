/**
 * PATCH /api/users/me/course-state
 *
 * Keeps `currentCourse` and `lastLoginAt` fresh on a User doc. Two auth paths
 * (see `resolve-auth.ts` for full rules):
 *   - Cookie session: self-write only — target = req.user.id.
 *   - Service token: `x-service-token` header + body `userId` — the Web app's
 *     server-side proxy uses this so browser clients never see the Admin
 *     cookie.
 *
 * `lastLoginAt` is always stamped server-side (`new Date().toISOString()`),
 * never taken from the request, so callers cannot forge past activity
 * timestamps regardless of auth path.
 *
 * @fileType api-route
 * @domain users
 * @pattern self-write, dual-auth, server-side-only-fields
 *
 * Body (zod-validated, all fields optional — empty body = pure heartbeat):
 *   - currentCourse  string  — courses id; verified to exist before writing
 *   - userId         string  — target user id; required with service token,
 *                              forbidden with cookie auth
 *
 * Response: 200 { success: true, data: { currentCourse, lastLoginAt } }
 * Errors:
 *   400 — invalid body, non-existent course, ambiguous/mismatched auth
 *   401 — unauthenticated (no cookie, no/invalid service token)
 *   500 — unexpected
 */
import crypto from 'crypto'

import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { logger } from '@/infra/utils/logger'
import { resolveCourseStateAuth } from './resolve-auth'

const requestSchema = z.object({
  userId: z.string().min(1).optional(),
  currentCourse: z.string().min(1).optional(),
})

export async function updateCourseState(req: PayloadRequest & { json?: () => Promise<unknown> }) {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  let body: unknown
  try {
    body = req.json ? await req.json() : null
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  // Empty/null body is valid — this endpoint doubles as a "user is active now"
  // heartbeat that only refreshes lastLoginAt.
  const parsed = requestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return Response.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { userId, currentCourse } = parsed.data

  const auth = resolveCourseStateAuth(req, userId)
  if (!auth.ok) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status })
  }

  if (currentCourse) {
    try {
      const course = await req.payload.findByID({
        collection: 'courses',
        id: currentCourse,
        depth: 0,
        overrideAccess: true,
        req,
      })
      if (!course) {
        return Response.json({ success: false, error: 'Course not found' }, { status: 400 })
      }
    } catch (err) {
      if (err instanceof Error && /not found/i.test(err.message)) {
        return Response.json({ success: false, error: 'Course not found' }, { status: 400 })
      }
      throw err
    }
  }

  const data: Record<string, unknown> = {
    lastLoginAt: new Date().toISOString(),
  }
  if (currentCourse !== undefined) data.currentCourse = currentCourse

  try {
    const updated = await req.payload.update({
      collection: 'users',
      id: auth.targetUserId,
      data,
      overrideAccess: true,
      depth: 0,
      req,
    })

    return Response.json({
      success: true,
      data: {
        currentCourse:
          typeof updated.currentCourse === 'object' && updated.currentCourse !== null
            ? updated.currentCourse.id
            : (updated.currentCourse ?? null),
        lastLoginAt: updated.lastLoginAt ?? null,
      },
    })
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return Response.json({ success: false, error: 'User not found' }, { status: 400 })
    }
    reqLogger.error(
      { err: err instanceof Error ? err.message : String(err), targetUserId: auth.targetUserId },
      'Failed to update user course state',
    )
    throw err
  }
}
