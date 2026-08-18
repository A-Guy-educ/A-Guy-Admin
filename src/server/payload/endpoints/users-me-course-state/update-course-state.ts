/**
 * PATCH /api/users/me/course-state
 *
 * Self-write endpoint the Web app calls on login and lesson open to keep the
 * User doc's `currentCourse` and `lastLoginAt` fields fresh. Always writes to
 * `req.user.id` — never accepts a target user id — so the surface can't be
 * abused to overwrite another user's state.
 *
 * `lastLoginAt` is always stamped server-side (`new Date().toISOString()`),
 * never taken from the request, so an authenticated user cannot forge a past
 * activity timestamp and corrupt admin analytics.
 *
 * @fileType api-route
 * @domain users
 * @pattern self-write, authenticated-only, server-side-only-fields
 *
 * Body (zod-validated, all fields optional — empty body = pure heartbeat):
 *   - currentCourse  string  — courses id; verified to exist before writing
 *
 * Response: 200 { success: true, data: { currentCourse, lastLoginAt } }
 * Errors:
 *   400 — invalid body, non-existent course
 *   401 — unauthenticated
 *   500 — unexpected
 */
import crypto from 'crypto'

import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { logger } from '@/infra/utils/logger'

const requestSchema = z.object({
  currentCourse: z.string().min(1).optional(),
})

export async function updateCourseState(req: PayloadRequest & { json?: () => Promise<unknown> }) {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  if (!req.user) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

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

  const { currentCourse } = parsed.data

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
      id: req.user.id,
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
    reqLogger.error(
      { err: err instanceof Error ? err.message : String(err), userId: req.user.id },
      'Failed to update user course state',
    )
    throw err
  }
}
