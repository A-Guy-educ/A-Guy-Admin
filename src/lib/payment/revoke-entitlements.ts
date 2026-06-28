/**
 * Revoke entitlements that were granted by a specific transaction.
 *
 * Called when a transaction's status transitions to 'refunded' — covers
 * Stripe `charge.refunded`, PayPal `PAYMENT.CAPTURE.REFUNDED`, and the
 * admin refund endpoint, all funneled through the Transactions afterChange
 * hook so the revocation logic lives in exactly one place.
 *
 * Idempotency: re-running this for the same transaction is safe.
 * Cancelling already-cancelled Enrollments is a no-op; pulling
 * featureEntitlements by transactionId is a set operation.
 *
 * @fileType utility
 * @domain payments
 * @pattern revocation, idempotent-cleanup
 */

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

interface RevokeParams {
  payload: Payload
  userId: string
  transactionId: string
}

export async function revokeProductEntitlements({
  payload,
  userId,
  transactionId,
}: RevokeParams): Promise<void> {
  // 1. Cancel matching Enrollments. Match on (user, metadata.paymentId)
  // because Enrollments persist a transactionId in `metadata.paymentId`.
  // `pagination: false` so we don't silently drop matches past an arbitrary
  // page size — one transaction usually grants one enrollment, but the
  // hard cap was a silent failure mode that a re-run wouldn't recover.
  const enrollments = await payload.find({
    collection: 'enrollments',
    where: {
      and: [{ user: { equals: userId } }, { 'metadata.paymentId': { equals: transactionId } }],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  if (enrollments.docs.length > 25) {
    payload.logger.warn(
      { userId, transactionId, count: enrollments.docs.length },
      'revokeProductEntitlements: revoking an unusually large number of enrollments for a single transaction',
    )
  }

  for (const enrollment of enrollments.docs) {
    if ((enrollment as { status?: string }).status === 'cancelled') continue
    const enrollmentId = (enrollment as { id: string }).id
    try {
      await payload.update({
        collection: 'enrollments',
        id: enrollmentId,
        data: {
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
        },
        overrideAccess: true,
      })
    } catch (error) {
      // Log and continue — a single failed cancellation must not skip the
      // remaining enrollments or the feature-entitlement $pull below.
      payload.logger.error(
        { err: error, enrollmentId, userId, transactionId },
        'revokeProductEntitlements: failed to cancel enrollment; continuing',
      )
    }
  }

  // 2. Pull featureEntitlements rows added by this transaction. Single $pull
  // with a match on transactionId removes every entry created by this purchase.
  const usersCollection = payload.db.collections['users']
  await usersCollection.updateOne(
    { _id: new ObjectId(userId) },
    {
      $pull: {
        featureEntitlements: { transactionId },
      },
    },
  )
}
