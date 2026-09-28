/**
 * Recompute Tier on Subscription Status Change Hook
 *
 * afterChange hook on Subscriptions that recomputes the owning user's
 * `currentTier` whenever the subscription's status changes. Complements
 * the Transactions recomputeTierOnSuccess hook: some subscription
 * lifecycle events (BILLING.SUBSCRIPTION.CANCELLED / EXPIRED / SUSPENDED,
 * and grace-period ends) flip the sub status without producing a matching
 * refunded/succeeded transaction, so the tx-only trigger misses them.
 *
 * Fires on the sub status transition (any change), because:
 *   - active → past_due / cancelled / expired / suspended  → the sub
 *     stops contributing tier (or shifts under a grace-window rule),
 *     recompute drops the user to the next-highest surviving tier.
 *   - past_due → active                                    → recovery,
 *     recompute promotes the user back if this sub was the highest.
 *   - pending → active                                     → initial
 *     activation; the tx hook usually handles this too, but firing here
 *     is idempotent so a race between the two is harmless (both
 *     converge on the same derived state).
 *
 * @fileType hook
 * @domain billing
 * @pattern derived-state-refresh, subscription-lifecycle
 */

import type { CollectionAfterChangeHook } from 'payload'

import { recomputeUserTier } from '@/lib/payment/recompute-tier'

export const recomputeTierOnStatusChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  const currentStatus = doc.status as string | undefined
  const prevStatus = previousDoc?.status as string | undefined

  // Only run on actual status transitions, not on cosmetic updates
  // (currentPeriodEnd rolls forward, cancelAtPeriodEnd toggles, etc.).
  // Those don't change what the recompute would derive.
  if (operation === 'update' && currentStatus === prevStatus) return doc

  const userId = typeof doc.user === 'string' ? doc.user : (doc.user as { id?: string })?.id
  if (!userId) {
    req.payload.logger.warn(
      { subscriptionId: doc.id },
      'recomputeTierOnStatusChange: subscription has no user; skipping tier recompute',
    )
    return doc
  }

  try {
    await recomputeUserTier(req.payload, userId, req)
  } catch (error) {
    // Log and swallow — tier is derived state and can be recomputed by
    // the next entitlement event or a manual admin action. Throwing here
    // would return 500 to PayPal and trigger a webhook retry storm.
    req.payload.logger.error(
      { err: error, subscriptionId: doc.id, userId },
      'recomputeTierOnStatusChange: failed to recompute tier after subscription status change',
    )
  }

  return doc
}
