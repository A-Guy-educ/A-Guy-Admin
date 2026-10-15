/**
 * extendTierSubscription — provider-agnostic tier-subscription activate/renewal.
 *
 * Call sites:
 *   - Tranzilla bootstrap: on the first successful notify_url POST,
 *     promotes a `pending` sub → `active` with period = now + 1 month.
 *   - Tranzilla renewal cron: on each successful merchant-initiated charge
 *     against the stored card token, rolls the period forward.
 *   - (Future) PayPal BILLING.SUBSCRIPTION.ACTIVATED / PAYMENT.SALE.COMPLETED
 *     for tier subs if that path is ever revived.
 *
 * Writes (atomically from the caller's POV, but across two collections):
 *   - users.currentTier + llmTokensLimit (via applyTierPurchase, raw Mongo).
 *   - users.llmTokensUsed → 0, users.llmTokensResetAt → newPeriodEnd. The
 *     "I just paid, give me a fresh month" invariant. Done here rather than
 *     relying on the monthly cron so the reset is tied to the pay date.
 *   - users.tierGrantSource = 'subscription' so the gate can tell paid-
 *     subscriber from legacy one-time grants.
 *   - subscriptions.status = 'active', currentPeriodStart/End, retry = 0.
 *   - subscriptions.introChargesUsed +1 when isIntroCharge is true, so the
 *     next cycle rolls over to the regular price automatically.
 *
 * Idempotency: NOT internally idempotent. Callers must ensure "this charge
 * for this sub has not been applied before" — the Tranzilla webhook does
 * this via the WebhookEvents dedup gate + a per-charge providerTransactionId
 * on the renewal Transaction, and the cron does it via a per-sub period
 * guard before firing. Calling twice would double-reset the token counter
 * and over-advance the intro counter.
 *
 * @fileType utility
 * @domain payments
 */

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

import { applyTierPurchase } from '@/lib/payment/apply-tier-purchase'
import type { TierSlug } from '@/lib/tiers/constants'
import { getUsersMongoCollection } from '@/server/services/internal/users-mongo-collection'

export interface ExtendTierSubscriptionArgs {
  payload: Payload
  userId: string
  tierSlug: TierSlug
  subscriptionId: string
  newPeriodStart: Date
  newPeriodEnd: Date
  isIntroCharge: boolean
}

export async function extendTierSubscription(args: ExtendTierSubscriptionArgs): Promise<void> {
  const { payload, userId, tierSlug, subscriptionId, newPeriodStart, newPeriodEnd, isIntroCharge } =
    args

  // 1. Promote the user to the tier (sets currentTier + llmTokensLimit).
  await applyTierPurchase(payload, userId, tierSlug)

  // 2. Roll the token counter and reset-date. Raw-mongo because these
  //    fields are blocked at the Payload access layer (server-only writes).
  const users = getUsersMongoCollection(payload)
  if (!users) {
    throw new Error('extendTierSubscription: raw MongoDB connection unavailable')
  }
  await users.updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        llmTokensUsed: 0,
        llmTokensResetAt: newPeriodEnd,
        tierGrantSource: 'subscription',
        updatedAt: new Date(),
      },
    },
  )

  // 3. Advance the Subscription row. Raw-mongo so we can combine $set with
  //    the conditional $inc on introChargesUsed in a single write.
  const subscriptions = payload.db.collections['subscriptions']
  const update: Record<string, unknown> = {
    $set: {
      status: 'active',
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd,
      tranzillaRetryCount: 0,
      updatedAt: new Date(),
    },
  }
  if (isIntroCharge) {
    update.$inc = { introChargesUsed: 1 }
  }
  await subscriptions.updateOne({ _id: new ObjectId(subscriptionId) }, update)
}
