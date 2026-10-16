/**
 * GET /api/cron/tranzilla-renewals
 *
 * Hourly Vercel cron entry point for the Tranzilla recurring-charge sweeper.
 *
 * Business logic lives in `sweepTranzillaRenewals`
 * (src/server/payload/endpoints/cron/tranzilla-renewals.ts) — this file is
 * the thin HTTP wrapper: auth, invoke, structured response.
 *
 * The sweep calls out to Tranzilla's direct-charge API per eligible sub.
 * Even at modest subscriber counts a single invocation can take tens of
 * seconds, so we raise maxDuration beyond the Vercel default.
 */
import { timingSafeEqual } from 'crypto'

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

import { logger } from '@/infra/utils/logger'
import { sweepTranzillaRenewals } from '@/server/payload/endpoints/cron/tranzilla-renewals'

export const maxDuration = 300

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    // Fail closed. This cron performs merchant-initiated charges against
    // the live Tranzilla terminal — a preview/dev deploy pointed at the
    // real DB with no CRON_SECRET is a billing-side exploit vector, not
    // a dev convenience. Local invocations should set CRON_SECRET or an
    // explicit `ALLOW_UNAUTHENTICATED_CRON=1` opt-in.
    return process.env.ALLOW_UNAUTHENTICATED_CRON === '1'
  }
  const auth = request.headers.get('authorization') ?? ''
  const expectedHeader = `Bearer ${expected}`
  // Compare bytes, not UTF-16 code units: a non-ASCII character in the
  // secret can match on string length while differing in byte length,
  // which would make timingSafeEqual throw ERR_CRYPTO_TIMING_SAFE_EQUAL_UNEQUAL_LENGTH
  // and 500 the cron (self-DoS on secret rotation to a non-ASCII value).
  const authBuf = Buffer.from(auth, 'utf8')
  const expectedBuf = Buffer.from(expectedHeader, 'utf8')
  if (authBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(authBuf, expectedBuf)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID()
  const reqLogger = logger.child({ requestId })

  if (!isAuthorized(request)) {
    reqLogger.warn('[cron/tranzilla-renewals] Unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await sweepTranzillaRenewals(payload)

    reqLogger.info({ ...result }, '[cron/tranzilla-renewals] Sweep complete')

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reqLogger.error({ error: message }, '[cron/tranzilla-renewals] Sweep failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
