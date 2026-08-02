/**
 * Enrollments Expiry Sweeper Cron Job
 *
 * Flips active enrollments whose `expiresAt` has passed to `status: 'expired'`.
 * Nothing else changes the status when time-limited access lapses, so without
 * this sweep the web-side paywall keeps letting expired users through
 * (its query excludes only `status: 'cancelled'`).
 *
 * Uses Payload's bulk `update({ where, data })` so all matching enrollments
 * are flipped in one query — no manual pagination loop, no risk of a failed
 * row being re-selected and re-attempted indefinitely.
 */

import type { PayloadRequest } from 'payload'

import { withCronMiddleware, type CronResult } from './cron-middleware'

interface UpdateError {
  message: string
  id?: string | number
}

async function sweepExpiredEnrollments(
  payload: PayloadRequest['payload'],
): Promise<{ expiredCount: number; errors: UpdateError[] }> {
  const nowIso = new Date().toISOString()

  const result = await payload.update({
    collection: 'enrollments',
    where: {
      and: [
        { status: { equals: 'active' } },
        { expiresAt: { exists: true } },
        { expiresAt: { not_equals: null } },
        { expiresAt: { less_than_equal: nowIso } },
      ],
    },
    data: { status: 'expired' },
    overrideAccess: true,
  })

  const errors = (result.errors ?? []).map((e) => ({
    message: e.message,
    id: e.id as string | number | undefined,
  }))

  return {
    expiredCount: result.docs.length,
    errors,
  }
}

export const enrollmentsExpiryEndpoint = {
  path: '/cron/enrollments-expiry',
  method: 'post' as const,
  handler: withCronMiddleware(async ({ payload, reqLogger }): Promise<CronResult> => {
    const { expiredCount, errors } = await sweepExpiredEnrollments(payload)

    reqLogger.info(
      { expiredCount, failedCount: errors.length },
      '[enrollments-expiry] Sweep complete',
    )

    for (const err of errors) {
      reqLogger.error(
        { enrollmentId: err.id, error: err.message },
        '[enrollments-expiry] Failed to expire enrollment',
      )
    }

    return {
      success: true,
      data: {
        expiredCount,
        failedCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    }
  }),
}
