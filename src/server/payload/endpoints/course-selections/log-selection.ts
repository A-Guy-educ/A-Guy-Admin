/**
 * POST /api/course-selections
 *
 * Logs a course-selection event from the web client.
 *
 * @fileType api-route
 * @domain analytics
 * @pattern event-tracking, anonymous-friendly, rate-limited
 * @ai-summary Validates a course-pick payload, verifies the course exists,
 *   hashes IP/UA server-side, attaches the authenticated user if any,
 *   applies a small per-IP rate limit, and creates exactly one row.
 *
 * Body (zod-validated):
 *   - course      string (required)  — courses id
 *   - source      enum    (required) — start-page | homepage-greeting | course-card | other
 *   - guestId     string  (optional) — opaque client id for anonymous picks
 *   - gradeLevel  string  (optional) — mirrors LocalUserProfile.gradeLevel on web
 *
 * Response: 200 { success: true } on success. Never echoes the stored row.
 * Errors:
 *   400 — invalid body, missing course, non-existent course
 *   429 — rate limited
 *   500 — unexpected
 */
import crypto from 'crypto'

import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { logger } from '@/infra/utils/logger'
import { checkRateLimit } from '@/server/services/rate-limit'
import { COURSE_SELECTION_SOURCES } from '@/server/payload/collections/CourseSelections'

const requestSchema = z.object({
  course: z.string().min(1),
  source: z.enum(COURSE_SELECTION_SOURCES),
  guestId: z.string().min(1).max(128).optional(),
  gradeLevel: z.string().max(64).optional(),
})

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

function hashFingerprint(value: string | null): string {
  if (!value) return ''
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function extractClientIp(headers: Headers): string | null {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    null
  )
}

export async function logCourseSelection(req: PayloadRequest & { json?: () => Promise<unknown> }) {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  let body: unknown
  try {
    body = req.json ? await req.json() : null
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const { course: courseId, source, guestId, gradeLevel } = parsed.data

  const requestHeaders = req.headers instanceof Headers ? req.headers : new Headers()
  const ip = extractClientIp(requestHeaders)
  const userAgent = requestHeaders.get('user-agent')

  const ipHash = hashFingerprint(ip)
  const userAgentHash = hashFingerprint(userAgent)

  const rate = await checkRateLimit(
    ipHash || 'unknown',
    userAgentHash || 'unknown',
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  )
  if (!rate.allowed) {
    reqLogger.warn({ ipHash, userAgentHash }, 'Course-selection rate limit exceeded')
    return Response.json(
      { success: false, error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))),
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  try {
    const course = await req.payload.findByID({
      collection: 'courses',
      id: courseId,
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

  try {
    await req.payload.create({
      collection: 'course-selections',
      data: {
        course: courseId,
        user: req.user?.id ?? undefined,
        guestId,
        gradeLevel,
        source,
        ipHash,
        userAgentHash,
      },
      overrideAccess: true,
      req,
    })
  } catch (err) {
    reqLogger.error(
      { err: err instanceof Error ? err.message : String(err), courseId, source },
      'Failed to persist course selection',
    )
    throw err
  }

  reqLogger.info({ courseId, source, hasUser: Boolean(req.user) }, 'Course selection logged')

  return Response.json({ success: true })
}
