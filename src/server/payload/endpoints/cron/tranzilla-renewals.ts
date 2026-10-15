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

/**
 * Row-level lock window. The sweep writes `lastRenewalAttemptAt=now` before
 * calling Tranzilla; any concurrent sweeper reading the same row inside this
 * window fails the CAS predicate and skips. A crashed sweeper's lock
 * self-releases after STALE_LOCK_MS so no sub can be permanently stuck.
 *
 * Must be shorter than the cron cadence (hourly) with headroom for sweep
 * runtime — 30 minutes gives us ~30 min of margin against overlapping runs.
 */
export const STALE_LOCK_MS = 30 * 60 * 1000

/**
 * Hard pagination ceiling per sweep. Hit this and `backlogClipped` is set
 * so ops can alert on sustained backlog (e.g. after an outage or a cohort
 * mass-expiry). Shouldn't matter at typical subscriber scale.
 */
export const SWEEP_PAGE_LIMIT = 500

/**
 * Max in-flight Tranzilla charges at once. Keeps the sweep under Vercel's
 * 300s maxDuration ceiling even at the full page limit (500 subs at ~1-2s
 * per charge → ~1-2 min at concurrency 10). Rows have independent CAS
 * locks so parallel processing can't double-apply any one sub.
 */
export const RENEWAL_CONCURRENCY = 10

export interface TranzillaRenewalSweepResult {
  processed: number
  renewed: number
  retried: number
  expired: number
  softCancelExpired: number
  /** Count of subs skipped due to transient provider errors (not declines). */
  providerErrors: number
  /** Count of subs skipped because another sweeper held the CAS lock. */
  skippedLocked: number
  /** True when either sweep hit the pagination ceiling — ops should widen or paginate. */
  backlogClipped: boolean
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
    providerErrors: 0,
    skippedLocked: 0,
    backlogClipped: false,
    errors: [],
  }

  const now = new Date()
  const dueCutoff = new Date(now.getTime() + 60 * 60 * 1000)
  const staleLockCutoff = new Date(now.getTime() - STALE_LOCK_MS)

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
    limit: SWEEP_PAGE_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  if (softCancels.docs.length === SWEEP_PAGE_LIMIT) {
    result.backlogClipped = true
    payload.logger.warn(
      { limit: SWEEP_PAGE_LIMIT },
      '[cron/tranzilla-renewals] soft-cancel sweep hit page ceiling — backlog likely truncated',
    )
  }

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
    limit: SWEEP_PAGE_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  if (due.docs.length === SWEEP_PAGE_LIMIT) {
    result.backlogClipped = true
    payload.logger.warn(
      { limit: SWEEP_PAGE_LIMIT },
      '[cron/tranzilla-renewals] due-for-charge sweep hit page ceiling — backlog likely truncated',
    )
  }

  // Process in bounded-concurrency batches so a full SWEEP_PAGE_LIMIT doesn't
  // exceed Vercel's maxDuration (300s). At ~1-2s per Tranzilla POST,
  // sequential execution would need ~8-16 minutes for 500 subs; parallel
  // execution with concurrency 10 brings it to ~1-2 minutes. Each sub's
  // state transitions are guarded by independent raw-mongo CAS writes,
  // so parallel processing is safe.
  const subsToProcess = due.docs as unknown as SubscriptionRow[]
  for (let i = 0; i < subsToProcess.length; i += RENEWAL_CONCURRENCY) {
    const batch = subsToProcess.slice(i, i + RENEWAL_CONCURRENCY)
    await Promise.allSettled(
      batch.map((sub) =>
        processOneRenewal(payload, sub, result, { dueCutoff, staleLockCutoff }).catch((err) => {
          result.errors.push({
            subscriptionId: sub.id,
            message: err instanceof Error ? err.message : String(err),
          })
          payload.logger.error(
            { err: err instanceof Error ? err.message : String(err), subscriptionId: sub.id },
            '[cron/tranzilla-renewals] subscription processing failed',
          )
        }),
      ),
    )
  }

  return result
}

interface RenewalContext {
  dueCutoff: Date
  staleLockCutoff: Date
}

async function processOneRenewal(
  payload: Payload,
  sub: SubscriptionRow,
  result: TranzillaRenewalSweepResult,
  ctx: RenewalContext,
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

  // Per-sub CAS lock. The predicate re-asserts the same eligibility the
  // outer find used (status, cancelAtPeriodEnd, currentPeriodEnd) and
  // additionally requires lastRenewalAttemptAt to be absent or older than
  // the stale cutoff. Only the sweeper that wins the CAS proceeds to the
  // provider call; a concurrent sweeper sees modifiedCount=0 and skips.
  const subsCollection = payload.db.collections['subscriptions']
  const lockNow = new Date()
  const lockResult = await subsCollection.updateOne(
    {
      _id: new ObjectId(sub.id),
      status: { $in: ['active', 'past_due'] },
      cancelAtPeriodEnd: { $ne: true },
      currentPeriodEnd: { $lte: ctx.dueCutoff },
      $or: [
        { lastRenewalAttemptAt: { $exists: false } },
        { lastRenewalAttemptAt: null },
        { lastRenewalAttemptAt: { $lt: ctx.staleLockCutoff } },
      ],
    },
    { $set: { lastRenewalAttemptAt: lockNow } },
  )
  if (lockResult.modifiedCount !== 1) {
    result.skippedLocked += 1
    payload.logger.info(
      { subscriptionId: sub.id },
      '[cron/tranzilla-renewals] CAS skip — row locked by another sweeper or no longer due',
    )
    return
  }

  result.processed += 1

  // Pre-flight BEFORE the external charge — every value we need downstream
  // of the charge is resolved here so an exception after the charge cannot
  // open a double-charge window (card debited, Sub period not advanced,
  // stale-lock expiry re-selects on the next sweep).
  const tenantId = resolveTenantId(sub.tenant)
  if (!tenantId) {
    throw new Error(`subscription ${sub.id} has no tenant — cannot create renewal transaction`)
  }
  const anchor = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date()
  const newPeriodEnd = addCalendarMonths(anchor, 1)

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

  // Provider transport error (HTTP non-2xx, missing Response field, network
  // failure). Explicitly NOT a decline — mapping an outage to a decline
  // would advance the retry counter and could force-expire every active
  // sub during a provider outage. Leave the row intact; the stale-lock
  // window releases automatically so the next sweep retries.
  if (charge.providerError) {
    result.providerErrors += 1
    payload.logger.error(
      {
        subscriptionId: sub.id,
        providerErrorReason: charge.providerErrorReason,
      },
      '[cron/tranzilla-renewals] Tranzilla provider error — skipping without retry/expire',
    )
    return
  }

  if (!charge.approved) {
    await recordFailedCharge(payload, sub, charge.responseCode, result)
    return
  }

  // Ordering matters for the double-charge guard:
  //
  // 1. extendTierSubscription advances the Sub's currentPeriodEnd FIRST
  //    (see that helper's reordering commit). As soon as that write lands,
  //    the next sweep's dueness filter won't re-match this row, so even if
  //    a later step throws we don't re-charge the same card for the same
  //    period.
  // 2. Then create the renewal Transaction. A failure here is a
  //    reconciliation issue (money moved, no DB record) — serious, but no
  //    longer a billing-side exploit vector. Logged at fatal level so ops
  //    can repair.
  //
  // If a different ordering looks cleaner later, keep the invariant: the
  // write that advances currentPeriodEnd must happen before any write that
  // can fail without first making this row ineligible for re-selection.
  await extendTierSubscription({
    payload,
    userId,
    tierSlug: sub.tierSlug as TierSlug,
    subscriptionId: sub.id,
    newPeriodStart: anchor,
    newPeriodEnd,
    isIntroCharge,
    order: 'renewal',
  })

  let renewalTxId: string | null = null
  try {
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
    renewalTxId = renewalTx.id
  } catch (txErr) {
    payload.logger.fatal(
      {
        err: txErr instanceof Error ? txErr.message : String(txErr),
        subscriptionId: sub.id,
        chargeIndex: charge.index,
        chargeConfirmationCode: charge.confirmationCode,
      },
      '[cron/tranzilla-renewals] CRITICAL — card was charged and Sub advanced, but renewal Transaction create FAILED. Manually record the charge and reconcile.',
    )
    // Rethrow so the sweep's error list captures it and the error isn't lost.
    throw txErr
  }

  result.renewed += 1
  payload.logger.info(
    {
      subscriptionId: sub.id,
      transactionId: renewalTxId,
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

  // Downgrade the user to the default tier — but ONLY if THIS subscription
  // is the one that granted the current tier. Scoping on
  // tierGrantSubscriptionId prevents the cross-sub leak:
  //   - cancel sub A (basic), re-subscribe via sub B (basic), sub A expires
  //     → sub B's charge set tierGrantSubscriptionId=B, so the predicate
  //     (tierGrantSubscriptionId=A) misses and B's grant survives.
  //   - legacy_one_time / manual grants never match (field is null for them).
  //   - cross-tier changes between sub creation and expiry: a tier change
  //     also updates tierGrantSubscriptionId, so stale sub expiries don't
  //     clobber.
  // Done via raw mongo because currentTier / llmTokensLimit are blocked at
  // the Payload access layer.
  const users = getUsersMongoCollection(payload)
  if (!users) {
    throw new Error('expireAndDowngrade: raw MongoDB connection unavailable')
  }
  const downgradeResult = await users.updateOne(
    {
      _id: new ObjectId(userId),
      tierGrantSubscriptionId: new ObjectId(sub.id),
    },
    {
      $set: {
        currentTier: DEFAULT_TIER,
        llmTokensLimit: TIER_LLM_TOKEN_CAP_MONTHLY[DEFAULT_TIER],
        tierGrantSource: null,
        tierGrantSubscriptionId: null,
        updatedAt: new Date(),
      },
    },
  )
  if (downgradeResult.matchedCount === 0) {
    payload.logger.info(
      { subscriptionId: sub.id, subTier: sub.tierSlug },
      '[cron/tranzilla-renewals] skipped user downgrade — current tier was not granted by this subscription',
    )
  }
}
