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
  const enrollments = await payload.find({
    collection: 'enrollments',
    where: {
      and: [{ user: { equals: userId } }, { 'metadata.paymentId': { equals: transactionId } }],
    },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })

  for (const enrollment of enrollments.docs) {
    if ((enrollment as { status?: string }).status === 'cancelled') continue
    await payload.update({
      collection: 'enrollments',
      id: (enrollment as { id: string }).id,
      data: {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
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
