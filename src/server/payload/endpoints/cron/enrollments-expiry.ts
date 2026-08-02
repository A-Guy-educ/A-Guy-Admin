/**
 * Enrollments Expiry Sweeper Cron Job
 *
 * Flips active enrollments whose `expiresAt` has passed to `status: 'expired'`.
 * Nothing else changes the status when time-limited access lapses, so without
 * this sweep the web-side paywall keeps letting expired users through
 * (its query excludes only `status: 'cancelled'`).
 */

import type { PayloadRequest } from 'payload'
import type { Logger } from 'pino'

import { withCronMiddleware, type CronResult } from './cron-middleware'

interface SweepResult {
  expiredCount: number
  failedCount: number
  errors: string[]
}

async function sweepExpiredEnrollments({
  payload,
  reqLogger,
}: {
  payload: PayloadRequest['payload']
  reqLogger: Logger
}): Promise<SweepResult> {
  const result: SweepResult = { expiredCount: 0, failedCount: 0, errors: [] }
  const nowIso = new Date().toISOString()

  let hasMore = true
  while (hasMore) {
    const { docs } = await payload.find({
      collection: 'enrollments',
      where: {
        and: [
          { status: { equals: 'active' } },
          { expiresAt: { exists: true } },
          { expiresAt: { not_equals: null } },
          { expiresAt: { less_than_equal: nowIso } },
        ],
      },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })

    hasMore = docs.length === 100

    for (const enrollment of docs) {
      try {
        await payload.update({
          collection: 'enrollments',
          id: enrollment.id,
          data: { status: 'expired' },
          overrideAccess: true,
        })
        result.expiredCount++
        reqLogger.info(
          { enrollmentId: enrollment.id, expiresAt: enrollment.expiresAt },
          '[enrollments-expiry] Flipped enrollment to expired',
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        result.failedCount++
        result.errors.push(`Enrollment ${enrollment.id}: ${errorMessage}`)
        reqLogger.error(
          { enrollmentId: enrollment.id, error: errorMessage },
          '[enrollments-expiry] Failed to expire enrollment',
        )
      }
    }
  }

  return result
}

export const enrollmentsExpiryEndpoint = {
  path: '/cron/enrollments-expiry',
  method: 'post' as const,
  handler: withCronMiddleware(async ({ payload, reqLogger }): Promise<CronResult> => {
    const result = await sweepExpiredEnrollments({ payload, reqLogger })

    if (result.errors.length > 0) {
      return {
        success: false,
        error: `Completed with ${result.errors.length} errors`,
        statusCode: 207,
      }
    }

    return {
      success: true,
      data: {
        expiredCount: result.expiredCount,
        failedCount: result.failedCount,
      },
    }
  }),
}
