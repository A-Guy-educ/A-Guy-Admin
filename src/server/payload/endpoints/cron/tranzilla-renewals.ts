/**
 * Tranzilla recurring-charge sweeper.
 *
 * Why admin runs this (and not web): Tranzilla doesn't fire a provider-side
 * renewal event like PayPal's PAYMENT.SALE.COMPLETED — recurring charges on
 * the stored card token are merchant-initiated. Admin is where the
 * Subscription state machine, the retry policy, and the merchant API
 * credentials all live, so admin owns the cron.
 *
 * Shape per run:
 *   1. Select Tranzilla subs that are due:
 *        provider = 'tranzilla'
 *        status IN ('active', 'past_due')
 *        currentPeriodEnd <= now + 1h  (small lead so the charge lands
 *                                        before access would lapse)
 *        cancelAtPeriodEnd = false      (soft-cancels get expired instead
 *                                        of charged — handled below)
 *   2. For each eligible sub, call Tranzilla's direct-charge API with the
 *      stored TranzilaTK.
 *   3. On approval:
 *        - Create a renewal Transactions row (isRenewal=true, isIntroCharge
 *          from the computed price).
 *        - Call extendTierSubscription with newPeriodEnd = current + 1mo
 *          (anchored on currentPeriodEnd, not now, so a late cron run
 *          doesn't shorten the user's access window).
 *   4. On decline:
 *        - Flip status to past_due and increment tranzillaRetryCount.
 *        - After `MAX_RETRIES` consecutive failures, expire the sub and
 *          downgrade the user to free.
 *   5. Separately, sweep soft-cancels where currentPeriodEnd has passed —
 *      mark expired and downgrade to free.
 *
 * Retry cadence: with the Vercel cron scheduled hourly (see vercel.json)
 * and the dueness filter above, a sub whose charge fails on hour N is
 * retried at hour N+1, N+2, etc. — the retry count hits MAX_RETRIES in
 * MAX_RETRIES hours, which is intentionally short for v1 so we see
 * failures fast. Shai can lengthen the grace by widening the dueness
 * filter (e.g. require `lastRenewalAttemptAt < now - 24h` for retries).
 *
 * This handler is best-effort per sub: a Tranzilla API failure on one row
 * does NOT prevent the sweep from processing the rest. All errors are
 * logged with the subscription id so ops can triage.
 */

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

import { computeNextChargePriceIls, isPaidTierSlug } from '@/lib/payment/tier-tranzilla-pricing'
import { chargeTranzillaToken } from '@/lib/payment/tranzilla'
import { extendTierSubscription } from '@/lib/payment/extend-tier-subscription'
import { addCalendarMonths } from '@/lib/payment/grant-entitlements'
import { DEFAULT_TIER, TIER_LLM_TOKEN_CAP_MONTHLY, type TierSlug } from '@/lib/tiers/constants'
import { getUsersMongoCollection } from '@/server/services/internal/users-mongo-collection'

export const MAX_RENEWAL_RETRIES = 3

export interface TranzillaRenewalSweepResult {
  processed: number
  renewed: number
  retried: number
  expired: number
  softCancelExpired: number
  errors: Array<{ subscriptionId: string; message: string }>
}

interface SubscriptionRow {
  id: string
  user: string | { id: string } | null
  tierSlug?: string | null
  tranzillaCardToken?: string | null
  tranzillaRetryCount?: number | null
  introPriceIls?: number | null
  introChargesTotal?: number | null
  introChargesUsed?: number | null
  regularPriceIls?: number | null
  currentPeriodEnd?: string | Date | null
  status: string
  cancelAtPeriodEnd?: boolean | null
  tenant?: string | { id: string } | null
}

function resolveUserId(user: SubscriptionRow['user']): string | null {
  if (!user) return null
  return typeof user === 'string' ? user : user.id
}

function resolveTenantId(tenant: SubscriptionRow['tenant']): string | null {
  if (!tenant) return null
  return typeof tenant === 'string' ? tenant : tenant.id
}

export async function sweepTranzillaRenewals(
  payload: Payload,
): Promise<TranzillaRenewalSweepResult> {
  const result: TranzillaRenewalSweepResult = {
    processed: 0,
    renewed: 0,
    retried: 0,
    expired: 0,
    softCancelExpired: 0,
    errors: [],
  }

  const now = new Date()
  const dueCutoff = new Date(now.getTime() + 60 * 60 * 1000)

  // ─── Soft-cancel expiry sweep ─────────────────────────────────────────
  // Users who cancelled mid-period keep access until currentPeriodEnd (per
  // the cancel endpoint's semantics). After it passes, no more charges —
  // expire the row and downgrade the user to free.
  const softCancels = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { provider: { equals: 'tranzilla' } },
        { cancelAtPeriodEnd: { equals: true } },
        { status: { in: ['active', 'past_due', 'cancelled'] } },
        { currentPeriodEnd: { less_than: now.toISOString() } },
      ],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  for (const doc of softCancels.docs as unknown as SubscriptionRow[]) {
    try {
      await expireAndDowngrade(payload, doc)
      result.softCancelExpired += 1
    } catch (err) {
      result.errors.push({
        subscriptionId: doc.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ─── Due-for-charge sweep ────────────────────────────────────────────
  const due = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { provider: { equals: 'tranzilla' } },
        { status: { in: ['active', 'past_due'] } },
        { cancelAtPeriodEnd: { equals: false } },
        { currentPeriodEnd: { less_than_equal: dueCutoff.toISOString() } },
      ],
    },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  for (const sub of due.docs as unknown as SubscriptionRow[]) {
    result.processed += 1
    try {
      await processOneRenewal(payload, sub, result)
    } catch (err) {
      result.errors.push({
        subscriptionId: sub.id,
        message: err instanceof Error ? err.message : String(err),
      })
      payload.logger.error(
        { err: err instanceof Error ? err.message : String(err), subscriptionId: sub.id },
        '[cron/tranzilla-renewals] subscription processing failed',
      )
    }
  }

  return result
}

async function processOneRenewal(
  payload: Payload,
  sub: SubscriptionRow,
  result: TranzillaRenewalSweepResult,
): Promise<void> {
  const userId = resolveUserId(sub.user)
  if (!userId) {
    throw new Error(`subscription ${sub.id} has no user`)
  }
  if (!isPaidTierSlug(sub.tierSlug)) {
    throw new Error(`subscription ${sub.id} has invalid tierSlug "${sub.tierSlug ?? 'null'}"`)
  }
  if (!sub.tranzillaCardToken) {
    throw new Error(`subscription ${sub.id} missing tranzillaCardToken — cannot charge`)
  }

  const { priceIls, isIntroCharge } = computeNextChargePriceIls({
    introPriceIls: sub.introPriceIls ?? null,
    introChargesTotal: sub.introChargesTotal ?? null,
    introChargesUsed: sub.introChargesUsed ?? 0,
    regularPriceIls: sub.regularPriceIls ?? 0,
  })
  if (!(priceIls > 0)) {
    throw new Error(`subscription ${sub.id} resolved to non-positive price: ${priceIls}`)
  }

  const charge = await chargeTranzillaToken({
    token: sub.tranzillaCardToken,
    sum: priceIls,
    currency: 'ILS',
    description: `AGuy renewal — ${sub.tierSlug}`,
  })

  if (!charge.approved) {
    await recordFailedCharge(payload, sub, charge.responseCode, result)
    return
  }

  // Approved — anchor new period on currentPeriodEnd (not now) so a late
  // cron run doesn't shorten the user's window. Falls back to now when
  // currentPeriodEnd is somehow null (shouldn't happen for an active sub).
  const anchor = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date()
  const newPeriodEnd = addCalendarMonths(anchor, 1)

  // Create the renewal Tx. If providerTransactionId collides (webhook
  // replay path for a wholly unrelated transaction), the unique-index
  // guard throws — surface as a sub-level error and move on. Tenant is
  // required on Transactions; a missing tenant on the Sub is a data bug
  // worth surfacing rather than silently dropping the renewal row.
  const tenantId = resolveTenantId(sub.tenant)
  if (!tenantId) {
    throw new Error(`subscription ${sub.id} has no tenant — cannot create renewal transaction`)
  }
  const renewalTx = await payload.create({
    collection: 'transactions',
    data: {
      tenant: tenantId,
      user: userId,
      tierSlug: sub.tierSlug,
      provider: 'tranzilla',
      providerTransactionId: charge.index ?? `tz-renewal-${new ObjectId().toHexString()}`,
      status: 'succeeded',
      amount: priceIls * 100,
      currency: 'ILS',
      isRenewal: true,
      isIntroCharge,
      subscription: sub.id,
      entitlementsGrantedAt: new Date().toISOString(),
      metadata: {
        tranzilla: {
          confirmationCode: charge.confirmationCode,
          responseCode: charge.responseCode,
        },
      },
    },
    draft: false,
    overrideAccess: true,
  })

  await extendTierSubscription({
    payload,
    userId,
    tierSlug: sub.tierSlug as TierSlug,
    subscriptionId: sub.id,
    newPeriodStart: anchor,
    newPeriodEnd,
    isIntroCharge,
  })

  result.renewed += 1
  payload.logger.info(
    {
      subscriptionId: sub.id,
      transactionId: renewalTx.id,
      priceIls,
      isIntroCharge,
      newPeriodEnd: newPeriodEnd.toISOString(),
    },
    '[cron/tranzilla-renewals] renewal charged',
  )
}

async function recordFailedCharge(
  payload: Payload,
  sub: SubscriptionRow,
  responseCode: string,
  result: TranzillaRenewalSweepResult,
): Promise<void> {
  const nextRetry = (sub.tranzillaRetryCount ?? 0) + 1
  const subsCollection = payload.db.collections['subscriptions']

  if (nextRetry >= MAX_RENEWAL_RETRIES) {
    await expireAndDowngrade(payload, sub)
    result.expired += 1
    payload.logger.warn(
      { subscriptionId: sub.id, responseCode, retryCount: nextRetry },
      '[cron/tranzilla-renewals] max retries reached — sub expired, user downgraded',
    )
    return
  }

  await subsCollection.updateOne(
    { _id: new ObjectId(sub.id) },
    {
      $set: {
        status: 'past_due',
        tranzillaRetryCount: nextRetry,
        updatedAt: new Date(),
      },
    },
  )
  result.retried += 1
  payload.logger.info(
    { subscriptionId: sub.id, responseCode, retryCount: nextRetry },
    '[cron/tranzilla-renewals] renewal declined — sub flipped to past_due',
  )
}

async function expireAndDowngrade(payload: Payload, sub: SubscriptionRow): Promise<void> {
  const userId = resolveUserId(sub.user)
  if (!userId) {
    throw new Error(`expireAndDowngrade: sub ${sub.id} has no user`)
  }

  // Mark the sub expired first — if the user downgrade crashes partway, the
  // sub still reflects reality for the next sweep.
  const subs = payload.db.collections['subscriptions']
  await subs.updateOne(
    { _id: new ObjectId(sub.id) },
    {
      $set: {
        status: 'expired',
        updatedAt: new Date(),
      },
    },
  )

  // Downgrade the user to the default tier and clear the subscription
  // grant source. Done via raw mongo because currentTier / llmTokensLimit
  // are blocked at the Payload access layer.
  const users = getUsersMongoCollection(payload)
  if (!users) {
    throw new Error('expireAndDowngrade: raw MongoDB connection unavailable')
  }
  await users.updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        currentTier: DEFAULT_TIER,
        llmTokensLimit: TIER_LLM_TOKEN_CAP_MONTHLY[DEFAULT_TIER],
        tierGrantSource: null,
        updatedAt: new Date(),
      },
    },
  )
}
