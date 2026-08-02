/**
 * GET /api/cron/enrollments-expiry
 *
 * Hourly Vercel cron entry point for the enrollment expiry sweeper.
 *
 * Vercel Cron dispatches GET (not POST), with an
 * `Authorization: Bearer <CRON_SECRET>` header. We verify with a
 * constant-time comparison to avoid leaking the secret via response-time
 * side channels.
 */
import { timingSafeEqual } from 'crypto'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

import { logger } from '@/infra/utils/logger'
import { sweepExpiredEnrollments } from '@/server/payload/endpoints/cron/enrollments-expiry'

// The sweep is a single `updateMany`, but on a large backlog (e.g. first
// deploy, promo-cohort mass expiry) the write can take a while — raise the
// ceiling above the 10-15s default.
export const maxDuration = 300

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return process.env.NODE_ENV !== 'production'
  }
  const auth = request.headers.get('authorization') ?? ''
  const expectedHeader = `Bearer ${expected}`
  if (auth.length !== expectedHeader.length) return false
  return timingSafeEqual(Buffer.from(auth, 'utf8'), Buffer.from(expectedHeader, 'utf8'))
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  if (!isAuthorized(request)) {
    reqLogger.warn('[cron/enrollments-expiry] Unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await sweepExpiredEnrollments(payload)

    reqLogger.info(
      { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
      '[cron/enrollments-expiry] Sweep complete',
    )

    return NextResponse.json({
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reqLogger.error({ error: message }, '[cron/enrollments-expiry] Sweep failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
