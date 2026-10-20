/**
 * extendTierSubscription — provider-agnostic tier-subscription activate/renewal.
 *
 * Call sites:
 *   - Tranzilla bootstrap: on the first successful notify_url POST,
 *     promotes a `pending` sub → `active` with period = now + 1 month.
 *     Call with `order: 'bootstrap'` — user writes run first so a partial
 *     failure leaves the Sub pending (admin UI reflects "payment not
 *     complete") rather than active-without-tier.
 *   - Tranzila STO renewal webhook: on each successful STO notify_url POST.
 *     Call with `order: 'renewal'` — Sub advance runs first so period math
 *     stays monotonic even if later writes crash.
 *
 * Idempotency: both writes are internally guarded. Replaying the same
 * (subscriptionId, newPeriodEnd) is a safe no-op:
 *   - Sub advance CAS: `currentPeriodEnd < newPeriodEnd` ensures a repeat
 *     call doesn't re-advance or double-increment `introChargesUsed`.
 *   - User writes CAS: `llmTokensResetAt < newPeriodEnd` ensures a repeat
 *     doesn't re-zero `llmTokensUsed` mid-period.
 * applyTierPurchase is trivially idempotent on same (userId, tierSlug).
 *
 * This idempotency lets the webhook replay path call this helper on a
 * sub that already looks promoted, repairing partial state (e.g. a prior
 * delivery that crashed between the two writes) without re-advancing the
 * fully-committed state.
 *
 * @fileType utility
 * @domain payments
 */

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

import { applyTierPurchase } from '@/lib/payment/apply-tier-purchase'
import type { TierSlug } from '@/lib/tiers/constants'
import { getUsersMongoCollection } from '@/server/services/internal/users-mongo-collection'

export type ExtendOrder = 'bootstrap' | 'renewal'

export interface ExtendTierSubscriptionArgs {
  payload: Payload
  userId: string
  tierSlug: TierSlug
  subscriptionId: string
  newPeriodStart: Date
  newPeriodEnd: Date
  isIntroCharge: boolean
  order: ExtendOrder
}

/**
 * Advance the Subscription row's lifecycle state for a new paid period.
 * CAS-guarded on currentPeriodEnd so a repeat call cannot double-advance
 * or double-increment the intro counter.
 */
async function advanceSubscriptionPeriod(args: {
  payload: Payload
  subscriptionId: string
  newPeriodStart: Date
  newPeriodEnd: Date
  isIntroCharge: boolean
}): Promise<boolean> {
  const { payload, subscriptionId, newPeriodStart, newPeriodEnd, isIntroCharge } = args
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
  // CAS: only advance if the current period is older than the target. On
  // a replay the equality check (==) makes the predicate fail and the
  // write is a no-op — introChargesUsed stays accurate.
  const result = await subscriptions.updateOne(
    {
      _id: new ObjectId(subscriptionId),
      $or: [
        { currentPeriodEnd: { $exists: false } },
        { currentPeriodEnd: null },
        { currentPeriodEnd: { $lt: newPeriodEnd } },
      ],
    },
    update,
  )
  return result.modifiedCount === 1
}

/**
 * Promote the user to the tier granted by this subscription. Includes
 * token-reset + grant-source + grant-source-id tracking. CAS-guarded on
 * llmTokensResetAt so a replay doesn't re-zero mid-period usage.
 */
async function promoteUserForTierSub(args: {
  payload: Payload
  userId: string
  tierSlug: TierSlug
  newPeriodEnd: Date
  subscriptionId: string
}): Promise<void> {
  const { payload, userId, tierSlug, newPeriodEnd, subscriptionId } = args

  // currentTier + llmTokensLimit — raw-mongo write, idempotent on same values.
  await applyTierPurchase(payload, userId, tierSlug)

  // Token-reset + provenance. CAS on llmTokensResetAt < newPeriodEnd
  // prevents a replay from re-zeroing mid-period usage. tierGrantSubscriptionId
  // is the key the cron's expireAndDowngrade predicate uses to scope the
  // downgrade to the exact sub that granted the current tier.
  const users = getUsersMongoCollection(payload)
  if (!users) {
    throw new Error('promoteUserForTierSub: raw MongoDB connection unavailable')
  }
  await users.updateOne(
    {
      _id: new ObjectId(userId),
      $or: [
        { llmTokensResetAt: { $exists: false } },
        { llmTokensResetAt: null },
        { llmTokensResetAt: { $lt: newPeriodEnd } },
      ],
    },
    {
      $set: {
        llmTokensUsed: 0,
        llmTokensResetAt: newPeriodEnd,
        tierGrantSource: 'subscription',
        // Cast to ObjectId explicitly — getUsersMongoCollection returns the
        // raw driver collection, which does NOT run Mongoose schema casting
        // on writes. The downgrade predicate in expireAndDowngrade filters
        // with `new ObjectId(sub.id)`, so storing a plain string here would
        // leave every expiry a silent no-op (user keeps paid tier for free).
        tierGrantSubscriptionId: new ObjectId(subscriptionId),
        updatedAt: new Date(),
      },
    },
  )
}

export async function extendTierSubscription(args: ExtendTierSubscriptionArgs): Promise<void> {
  const {
    payload,
    userId,
    tierSlug,
    subscriptionId,
    newPeriodStart,
    newPeriodEnd,
    isIntroCharge,
    order,
  } = args

  if (order === 'renewal') {
    // Sub advance FIRST — makes the row ineligible for re-selection on the
    // next sweep (the cron's dueness filter is `currentPeriodEnd <= now+1h`,
    // and the CAS at advanceSubscriptionPeriod advances currentPeriodEnd to
    // the new period before any user write). If a subsequent step crashes,
    // the stale-lock-expired retry path WILL NOT re-charge the card.
    await advanceSubscriptionPeriod({
      payload,
      subscriptionId,
      newPeriodStart,
      newPeriodEnd,
      isIntroCharge,
    })
    await promoteUserForTierSub({ payload, userId, tierSlug, newPeriodEnd, subscriptionId })
    return
  }

  // Bootstrap: user writes FIRST, Sub advance LAST. A partial failure here
  // leaves the Sub in `pending`, which is both admin-visible ("checkout
  // did not complete") and recoverable via the webhook dedup replay path
  // (see /api/webhooks/tranzilla: unprocessed events are re-handled).
  await promoteUserForTierSub({ payload, userId, tierSlug, newPeriodEnd, subscriptionId })
  await advanceSubscriptionPeriod({
    payload,
    subscriptionId,
    newPeriodStart,
    newPeriodEnd,
    isIntroCharge,
  })
}
