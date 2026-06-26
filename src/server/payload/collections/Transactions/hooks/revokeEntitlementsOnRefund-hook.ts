/**
 * Revoke Entitlements on Refund Hook
 *
 * afterChange hook on Transactions that revokes the entitlements granted by a
 * transaction whenever its status transitions to 'refunded'. Single revocation
 * funnel for all refund sources:
 *   - Stripe webhook `charge.refunded`
 *   - PayPal webhook `PAYMENT.CAPTURE.REFUNDED`
 *   - Admin refund endpoint
 *
 * Idempotency: only fires on the exact transition into 'refunded'. Updates
 * that leave the status as 'refunded' (or that come in already-refunded on
 * create) are no-ops.
 *
 * @fileType hook
 * @domain payments
 * @pattern transaction-revocation
 */

import type { CollectionAfterChangeHook } from 'payload'

import { revokeProductEntitlements } from '@/lib/payment/revoke-entitlements'

export const revokeEntitlementsOnRefund: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const currentStatus = doc.status as string | undefined
  const prevStatus = previousDoc?.status as string | undefined

  // Fire on the exact transition into 'refunded'. Two cases:
  //  - update: prev was something else (pending/succeeded/failed)
  //  - create: someone wrote a transaction directly with status='refunded'.
  //    The statusTransitionGuard skips create-time validation, so the
  //    schema technically allows it; we don't want such a record to leak
  //    entitlements that were never revoked.
  if (currentStatus !== 'refunded') return doc
  if (operation === 'update' && prevStatus === 'refunded') return doc

  const userId = typeof doc.user === 'string' ? doc.user : (doc.user as { id?: string })?.id
  if (!userId) {
    req.payload.logger.warn(
      { transactionId: doc.id },
      'revokeEntitlementsOnRefund: transaction has no user; skipping revocation',
    )
    return doc
  }

  try {
    await revokeProductEntitlements({
      payload: req.payload,
      userId,
      transactionId: String(doc.id),
    })
  } catch (error) {
    // Log but do not block the transaction update — the refund itself has
    // already happened at the provider; orphaned entitlements are surfaced
    // here for ops to clean up rather than rolling back the refund.
    req.payload.logger.error(
      { err: error, transactionId: doc.id, userId },
      'revokeEntitlementsOnRefund: failed to revoke entitlements after refund',
    )
  }

  return doc
}
