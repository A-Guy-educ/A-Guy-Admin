/**
 * Recompute Tier on Success Hook
 *
 * afterChange hook on Transactions that recomputes the user's derived
 * currentTier whenever a transaction lands in status='succeeded'. Fires on
 * both the pending→succeeded transition (checkout webhook flow) and on
 * direct create-with-succeeded (subscription renewal path).
 *
 * Why here and not in grant-entitlements: webhook handlers call
 * grantProductEntitlements BEFORE flipping the transaction to succeeded
 * (deliberate fail-safe — a throwing grant leaves the tx pending for
 * retry). If we called recomputeUserTier from grant-entitlements, it
 * would see the transaction still in status='pending' and exclude it,
 * dropping first-time buyers back to Free until a later entitlement
 * event. Firing on tx-status commit closes that timing hole.
 *
 * Refund path is not handled here — revokeEntitlementsOnRefund-hook already
 * invokes revokeProductEntitlements → recomputeUserTier.
 *
 * @fileType hook
 * @domain billing
 * @pattern derived-state-refresh, post-commit
 */

import type { CollectionAfterChangeHook } from 'payload'

import { recomputeUserTier } from '@/lib/payment/recompute-tier'

export const recomputeTierOnSuccess: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const currentStatus = doc.status as string | undefined
  const prevStatus = previousDoc?.status as string | undefined

  // Fire on the exact transition into 'succeeded':
  //  - update: prev was anything else (pending/failed/refunded)
  //  - create: someone wrote the transaction directly with status='succeeded'
  //    (renewal path — Web writes each renewal tx already-succeeded).
  if (currentStatus !== 'succeeded') return doc
  if (operation === 'update' && prevStatus === 'succeeded') return doc

  const userId = typeof doc.user === 'string' ? doc.user : (doc.user as { id?: string })?.id
  if (!userId) {
    req.payload.logger.warn(
      { transactionId: doc.id },
      'recomputeTierOnSuccess: transaction has no user; skipping tier recompute',
    )
    return doc
  }

  try {
    await recomputeUserTier(req.payload, userId, req)
  } catch (error) {
    // Log but do not block the transaction update — tier is derived state
    // and can be recomputed by the next entitlement event or a manual
    // admin action. Failing the tx here would return 500 to the payment
    // provider and trigger a retry storm.
    req.payload.logger.error(
      { err: error, transactionId: doc.id, userId },
      'recomputeTierOnSuccess: failed to recompute tier after tx succeeded',
    )
  }

  return doc
}
