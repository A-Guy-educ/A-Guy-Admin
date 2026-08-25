/**
 * GET /api/cron/verify-tx-indexes
 *
 * Daily Vercel cron entry point for the transactions unique-index guard.
 *
 * Moved out of `payload.config.ts::onInit` because running the check on
 * every serverless cold start was blocking user requests for ~6 seconds
 * per boot (aggregation across the transactions collection). The check is
 * diagnostic-only — it just logs ERROR if the unique index on
 * `providerTransactionId` is missing or duplicates exist. A daily cadence
 * catches drift within 24 hours with none of the per-cold-start tax.
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
import { verifyTransactionsProviderTxIdUniqueness } from '@/server/payload/migrations/verifyTransactionsUniqueness'

// The aggregation is O(n) over the transactions collection. Raise the ceiling
// above the 10-15s default so a growing collection doesn't kill the check.
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
    reqLogger.warn('[cron/verify-tx-indexes] Unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const result = await verifyTransactionsProviderTxIdUniqueness(payload)

    reqLogger.info({ result }, '[cron/verify-tx-indexes] Check complete')

    return NextResponse.json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reqLogger.error({ error: message }, '[cron/verify-tx-indexes] Check failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
