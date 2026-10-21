/**
 * Tranzilla Webhook Handler
 *
 * POST /api/webhooks/tranzilla
 *
 * Tranzilla fires a single notify_url POST for both approved and declined
 * charges (unlike PayPal's split order/capture/sale events). The handler:
 *
 *   1. Parses the form-encoded body (JSON accepted for test harnesses).
 *   2. Verifies `response_hash` when present (merchant enabled signing in the
 *      terminal dashboard). Falls back to log-and-accept when absent — the
 *      correct Tranzilla verification mechanism is still pending confirmation
 *      with their support team.
 *   3. Dedupes via WebhookEvents keyed on (provider: 'tranzilla', eventId:
 *      index). Replays short-circuit to a 200.
 *   4. Correlates the callback to a pending Transactions row via `u72`
 *      (which Web stuffs with the Payload Transactions `_id` when it builds
 *      the hosted-checkout URL).
 *   5. On `Response === "000"` → flips the Tx to `succeeded`, writes the real
 *      Tranzilla `index` into `providerTransactionId`, grants entitlements,
 *      consumes any applied coupon, and fires a purchase receipt.
 *   6. On any other response code → flips the Tx to `failed` with an error
 *      message that captures the decline code for ops.
 *
 * Tranzilla's hosted-iframe flow has no refund notify — refunds are
 * initiated and reconciled via the merchant dashboard. If/when that changes
 * we'll add a refund branch here.
 */

import { ObjectId } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { applyTierPurchase } from '@/lib/payment/apply-tier-purchase'
import { serializePaymentError } from '@/lib/payment/error-log'
import { extendTierSubscription } from '@/lib/payment/extend-tier-subscription'
import { addCalendarMonths, grantProductEntitlements } from '@/lib/payment/grant-entitlements'
import { getPaymentEnv } from '@/lib/payment/env'
import {
  cancelStandingOrder,
  createStandingOrder,
  formatTranzilaDate,
} from '@/lib/payment/tranzila-v2-client'
import { computeNextChargePriceIls } from '@/lib/payment/tier-tranzilla-pricing'
import { verifyTranzillaWebhook } from '@/lib/payment/tranzilla'
import { isTierSlug, type TierSlug } from '@/lib/tiers/constants'
import { sendPurchaseReceipt } from '@/server/email/services/purchase-receipt-service'

/** Long horizon — effectively indefinite. We pre-charged month 1 via the
 * iframe, so the STO covers months 2 through 120 → 119 payments. If a sub
 * ever reaches month 120 we'll handle renewal/extension at that point. */
const STO_TOTAL_PAYMENTS_FROM_IFRAME_BOOTSTRAP = 119

const TRANZILLA_APPROVED_CODE = '000'

type PayloadInstance = Awaited<ReturnType<typeof getPayload>>

/**
 * MongoDB duplicate-key error detection (code 11000 or E11000 in message).
 * Matches the shape in the PayPal handler so dedup races and
 * providerTransactionId uniqueness collisions are handled the same way.
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: number; message?: string; errors?: unknown[]; data?: unknown }
  if (e.code === 11000) return true
  if (/E11000|duplicate key/i.test(e.message ?? '')) return true
  if (/unique/i.test(e.message ?? '')) return true
  const errors = (e.data as { errors?: unknown[] })?.errors ?? e.errors
  if (Array.isArray(errors)) {
    return errors.some(
      (err2: unknown) =>
        typeof err2 === 'object' &&
        err2 !== null &&
        /unique/i.test((err2 as { message?: string }).message ?? ''),
    )
  }
  return false
}

export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })

  // ─── 1. Parse body ──────────────────────────────────────────────────────
  const contentType = request.headers.get('content-type') ?? ''
  let body: Record<string, string>
  try {
    if (contentType.includes('application/json')) {
      body = (await request.json()) as Record<string, string>
    } else {
      const text = await request.text()
      body = Object.fromEntries(new URLSearchParams(text).entries())
    }
  } catch (err) {
    payload.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[tranzilla-webhook] failed to parse body',
    )
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // ─── 2. Verify signature ────────────────────────────────────────────────
  // Policy: when Tranzila sends a `response_hash`, we HMAC-verify it against
  // our private key — mismatch is a hard reject. When it's absent, we
  // log-and-accept because the `response_hash` signing feature isn't
  // configurable on our current Tranzila terminal (`fxpaguy`): there's no
  // dashboard toggle to enable it. Previously prod required a signature and
  // left preview unsigned, which caused every prod webhook to 401 and left
  // bootstrapped subs stuck with no stoId (STO active on Tranzila's side,
  // dangling on ours).
  //
  // Risk accepted: an attacker who discovers the notify URL could POST a
  // crafted "approved" body and promote a user for one month of premium
  // (STO handoff fails on fake TranzilaTK so there's no recurring charge).
  // Bounded impact; followup mitigations (IP whitelist for Tranzila sender
  // range, random-suffix notify URL, or a real signing scheme once Tranzila
  // support confirms what the terminal supports) tracked separately.
  const hasHash = typeof body.response_hash === 'string' && body.response_hash.length > 0
  let authMethod: 'response_hash' | 'unsigned' = 'unsigned'

  if (hasHash) {
    const ok = verifyTranzillaWebhook(body)
    if (!ok) {
      const sourceIp =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      payload.logger.warn(
        { sourceIp, index: body.index },
        '[tranzilla-webhook] response_hash mismatch — rejecting',
      )
      return NextResponse.json({ error: 'Invalid response_hash' }, { status: 401 })
    }
    authMethod = 'response_hash'
  }

  // ─── 3. Extract key fields ──────────────────────────────────────────────
  const index = body.index
  const responseCode = body.Response ?? body.response ?? ''
  const transactionRowId = body.u72 // Payload Transactions._id (populated by Web / bootstrap)
  const subscriptionRowId = body.u73 // Payload Subscriptions._id (set by the subscription-bootstrap endpoint)

  if (!index) {
    payload.logger.warn(
      { body, authMethod },
      '[tranzilla-webhook] payload missing `index` — nothing to correlate; acknowledging',
    )
    return NextResponse.json({ received: true, warning: 'missing_index' }, { status: 200 })
  }

  // When no u72 is present we have three sub-cases, resolved in order:
  //   1. STO renewal: `sto_id` in the body maps to a live Subscription.
  //      Tranzila's My-Billing engine owns these POSTs; the sub was already
  //      bootstrapped by a prior iframe charge. Route to the renewal handler.
  //   2. STO renewal with unknown sto_id (orphan STO, different env, race
  //      against handoff): log + ack, nothing to process locally.
  //   3. Raw-dashboard charge (manual Tranzila admin): log + ack.
  // The expanded log in sub-cases 2 and 3 includes the full body-key list so
  // ops can see what Tranzila actually sends if the correlation strategy
  // needs updating (e.g. different field name for sto_id).
  let stoRenewalSubscriptionId: string | null = null
  if (!transactionRowId) {
    const stoIdFromBody = extractStoIdFromBody(body)
    if (stoIdFromBody) {
      const subResult = await payload.find({
        collection: 'subscriptions',
        where: {
          and: [{ provider: { equals: 'tranzilla' } }, { stoId: { equals: stoIdFromBody } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      const matchedSub = subResult.docs[0] as { id: string } | undefined
      if (matchedSub) {
        stoRenewalSubscriptionId = matchedSub.id
      } else {
        payload.logger.warn(
          {
            authMethod,
            index,
            responseCode,
            stoIdFromBody,
            bodyKeys: Object.keys(body),
          },
          '[tranzilla-webhook] sto_id in body but no Subscription matches — orphan STO or wrong environment',
        )
      }
    }

    if (!stoRenewalSubscriptionId) {
      payload.logger.info(
        {
          authMethod,
          index,
          responseCode,
          sum: body.sum,
          currency: body.currency,
          confirmationCode: body.ConfirmationCode,
          hasToken: Boolean(body.TranzilaTK),
          hasStoId: Boolean(stoIdFromBody),
          bodyKeys: Object.keys(body),
        },
        '[tranzilla-webhook] unassociated charge — no u72 and no matching stoId',
      )
      return NextResponse.json({ received: true, unassociated: true }, { status: 200 })
    }
  }

  // ─── 4. Dedup gate — WebhookEvents (provider, eventId) is unique ────────
  let webhookEventId: string | null = null
  try {
    const doc = await payload.create({
      collection: 'webhook-events',
      data: {
        provider: 'tranzilla',
        eventId: index,
        eventType: `tranzilla.notify.${responseCode || 'unknown'}`,
        processed: false,
        receivedAt: new Date().toISOString(),
      },
      draft: false,
      overrideAccess: true,
    })
    webhookEventId = doc.id
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Dedup — but if the prior delivery crashed before marking processed,
      // Tranzilla's retry would otherwise be swallowed and the sub stuck in
      // partial state. Look up the existing event: processed=true means a
      // true dedup; processed=false means fall through and re-run the
      // handler. The downstream helpers (extendTierSubscription,
      // flipTransactionSucceeded) are per-period idempotent, so re-running
      // on a fully-committed sub is a safe no-op.
      const existing = await payload.find({
        collection: 'webhook-events',
        where: {
          and: [{ provider: { equals: 'tranzilla' } }, { eventId: { equals: index } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      const existingDoc = existing.docs[0] as { id: string; processed?: boolean } | undefined
      if (!existingDoc || existingDoc.processed === true) {
        payload.logger.info(
          { index, responseCode, alreadyProcessed: existingDoc?.processed === true },
          '[tranzilla-webhook] event already processed — deduped',
        )
        return NextResponse.json({ received: true, deduped: true }, { status: 200 })
      }
      payload.logger.warn(
        { index, responseCode, webhookEventId: existingDoc.id },
        '[tranzilla-webhook] prior delivery left event unprocessed — replaying handler',
      )
      webhookEventId = existingDoc.id
    } else {
      payload.logger.error(
        { err: serializePaymentError(err), index },
        '[tranzilla-webhook] unexpected error during dedup gate',
      )
      return NextResponse.json({ error: 'Dedup gate error' }, { status: 500 })
    }
  }

  // ─── 5. Process the transaction ─────────────────────────────────────────
  // Routing invariants (set up above in sections 3 + 3b):
  //   - stoRenewalSubscriptionId set  → u72 absent, u73 absent, sto_id matched a sub
  //     → recurring STO charge from Tranzila's My-Billing engine
  //   - subscriptionRowId set         → u72 present, u73 present
  //     → bootstrap first charge from the hosted iframe
  //   - only transactionRowId set     → u72 present, u73 absent
  //     → one-time (non-subscription) charge
  // Section 3b early-returns on "no u72 AND no stoId match", so by this
  // point at least one of the three correlation keys is populated.
  try {
    if (stoRenewalSubscriptionId) {
      await handleTranzillaStoRenewal(payload, {
        subscriptionId: stoRenewalSubscriptionId,
        index,
        responseCode,
        body,
        authMethod,
      })
    } else if (subscriptionRowId) {
      await handleTranzillaSubscriptionBootstrap(payload, {
        index,
        responseCode,
        transactionRowId,
        subscriptionRowId,
        body,
        authMethod,
      })
    } else if (transactionRowId) {
      await handleTranzillaCallback(payload, {
        index,
        responseCode,
        transactionRowId,
        body,
        authMethod,
      })
    }
  } catch (err) {
    payload.logger.error(
      { err: serializePaymentError(err), index, transactionRowId },
      '[tranzilla-webhook] handler error',
    )
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  // ─── 6. Mark event processed ────────────────────────────────────────────
  if (webhookEventId) {
    await payload.update({
      collection: 'webhook-events',
      id: webhookEventId,
      data: { processed: true },
      overrideAccess: true,
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

interface HandleArgs {
  index: string
  responseCode: string
  transactionRowId: string
  body: Record<string, string>
  authMethod: 'response_hash' | 'unsigned'
}

async function handleTranzillaCallback(
  payload: PayloadInstance,
  { index, responseCode, transactionRowId, body, authMethod }: HandleArgs,
): Promise<void> {
  // Look up the pending Transactions row by its Payload _id.
  let transaction: TranzillaTx | null
  try {
    transaction = (await payload.findByID({
      collection: 'transactions',
      id: transactionRowId,
      depth: 0,
      overrideAccess: true,
    })) as TranzillaTx
  } catch {
    transaction = null
  }

  if (!transaction) {
    payload.logger.warn(
      { index, transactionRowId },
      '[tranzilla-webhook] no Transactions row for u72 — Web may not have persisted it before redirect',
    )
    return
  }

  // Idempotency — the Tx is already in a terminal state. Covers webhook
  // replays that slipped past the dedup gate (e.g. a prior run crashed
  // after flipping the Tx but before marking WebhookEvents.processed).
  if (transaction.status !== 'pending') {
    payload.logger.info(
      { index, transactionRowId, currentStatus: transaction.status },
      '[tranzilla-webhook] transaction already in terminal state — skipping',
    )
    return
  }

  const isApproved = responseCode === TRANZILLA_APPROVED_CODE
  const userId = resolveUserId(transaction.user)
  const productId = resolveProductId(transaction.product)

  if (!userId) {
    payload.logger.error(
      { transactionRowId },
      '[tranzilla-webhook] transaction missing user — cannot process',
    )
    throw new Error(`Transaction ${transactionRowId} missing user`)
  }

  if (!isApproved) {
    await markTransactionFailed(payload, transaction.id, index, responseCode)
    payload.logger.info(
      { index, transactionRowId, responseCode, authMethod },
      '[tranzilla-webhook] charge declined — transaction marked failed',
    )
    return
  }

  // ─── Approved path ──────────────────────────────────────────────────────
  // Grant entitlements BEFORE flipping status to succeeded. If grant throws
  // the Tx stays pending and the next webhook delivery retries.
  const tierSlug = transaction.tierSlug
  if (isTierSlug(tierSlug)) {
    await applyTierPurchase(payload, userId, tierSlug)
  } else if (productId) {
    await grantProductEntitlements(userId, productId, String(transaction.id))
  } else {
    throw new Error(
      `Transaction ${transactionRowId} has neither product nor valid tierSlug — cannot grant entitlements`,
    )
  }

  await flipTransactionSucceeded(payload, transaction, index, body)

  await consumeCouponIfPresent(payload, transaction)

  // Fire-and-forget receipt. Tier purchases send their receipt from Web
  // (same pattern as PayPal) — skip here when product is null.
  if (productId) {
    void sendPurchaseReceipt(payload, {
      transactionId: String(transaction.id),
      userId,
      productId,
      providerTransactionId: index,
      amount: transaction.amount,
      currency: transaction.currency,
      appliedCoupon: transaction.metadata?.appliedCoupon ?? null,
    })
  }

  payload.logger.info(
    { index, transactionRowId, authMethod, confirmationCode: body.ConfirmationCode },
    '[tranzilla-webhook] charge approved — transaction succeeded',
  )
}

interface TranzillaTx {
  id: string
  status: string
  user: string | { id: string } | null
  product: string | { id: string } | null
  tierSlug?: string | null
  amount: number
  currency: string
  tenant?: string | { id: string } | null
  metadata?: {
    appliedCoupon?: {
      code: string
      discountType: string
      discountValue: number
      originalAmount?: number
      discountedAmount?: number
    } | null
  } | null
}

interface TranzillaSubBootstrapArgs {
  index: string
  responseCode: string
  transactionRowId: string
  subscriptionRowId: string
  body: Record<string, string>
  authMethod: 'response_hash' | 'unsigned'
}

interface TranzillaSubscriptionDoc {
  id: string
  tenant?: string | { id: string } | null
  user: string | { id: string } | null
  tierSlug?: string | null
  status: string
  introPriceIls?: number | null
  introChargesTotal?: number | null
  introChargesUsed?: number | null
  regularPriceIls?: number | null
  currentPeriodStart?: string | Date | null
  currentPeriodEnd?: string | Date | null
  stoId?: string | null
}

/**
 * Pull the Tranzila standing-order id out of the recurring-charge notify_url
 * POST body. Tranzila's docs don't nail down a single field name across API
 * versions, so we accept the common variants. If an actual prod STO renewal
 * POST uses yet another name, the enhanced "unassociated" log below prints
 * every body key — eyeball that in production logs and extend this list.
 */
function extractStoIdFromBody(body: Record<string, string>): string | null {
  const candidates = ['sto_id', 'stoId', 'standing_order_id', 'standingOrderId', 'sto']
  for (const key of candidates) {
    const value = body[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

interface HandoffArgs {
  payload: PayloadInstance
  subscriptionRowId: string
  userId: string
  tierSlug: TierSlug
  regularPriceIls: number
  newPeriodEnd: Date
  cardToken: string
  cardExpireMonth: number
  cardExpireYear: number
}

/**
 * Parse the card expiry from Tranzila's notify_url POST body. Tranzila's
 * hosted iframe sends `expdate` in MMYY form (e.g. "1230" for Dec 2030);
 * some flows send separate `expmonth`/`expyear` fields instead. We accept
 * either. Returns null when neither is parseable — the caller must log
 * and skip the STO handoff in that case (the user still has their
 * promoted tier and month-1 charge, just no auto-renewal).
 */
function parseCardExpiry(body: Record<string, string>): { month: number; year: number } | null {
  // Format 1: expdate as MMYY string (most common on fxpaguy's notify_url).
  const expdate = body.expdate ?? body.expDate
  if (expdate && /^\d{4}$/.test(expdate)) {
    const month = parseInt(expdate.slice(0, 2), 10)
    const year = 2000 + parseInt(expdate.slice(2, 4), 10)
    if (month >= 1 && month <= 12 && year >= 2020) return { month, year }
  }
  // Format 2: separate expmonth + expyear fields (older iframes).
  const monthRaw = parseInt(body.expmonth ?? body.expMonth ?? '', 10)
  const yearRaw = parseInt(body.expyear ?? body.expYear ?? '', 10)
  if (monthRaw >= 1 && monthRaw <= 12 && yearRaw > 0) {
    // yearRaw may be 2-digit (30) or 4-digit (2030); normalize.
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw
    if (year >= 2020) return { month: monthRaw, year }
  }
  return null
}

/**
 * Call Tranzila's createstov2 to hand off the recurring charges to
 * My-Billing. On success, store the sto_id and null out the card token
 * (Tranzila now owns both the schedule and the credential).
 *
 * Correctness invariants (round-5 Kody review):
 *
 *  1. **Per-sub CAS claim before the API call.** Two concurrent webhook
 *     deliveries (dedup-gate replay race) each hold a local stale snapshot
 *     where `subscription.stoId == null`. Without a DB-level gate, both
 *     call createstov2 → Tranzila happily issues TWO sto_ids → user gets
 *     billed twice every month. The claim writes a sentinel into `stoId`
 *     and only the thread whose `updateOne` modifies 1 row proceeds.
 *
 *  2. **Rollback on DB write failure after a successful createstov2.** If
 *     Tranzila has already issued the sto_id and our local write throws,
 *     we would otherwise leave an orphan STO on Tranzila's side (which
 *     fires charges) AND leave the token on our sub (which the fallback
 *     cron also charges). Compensate by calling `cancelStandingOrder` to
 *     void the orphan + release the sentinel.
 *
 *  3. **Never throws.** All failure paths return cleanly; the webhook
 *     200s and `WebhookEvents.processed` is marked true, so Tranzila
 *     won't retry (we don't want retries on this handler — correctness
 *     relies on the single-shot claim).
 *
 * On un-rollbackable failure (DB write + cancel-STO both fail) ops has
 * two fatal log lines pinpointing the sto_id and the sub id for manual
 * cleanup.
 */
async function handoffToStandingOrder(args: HandoffArgs): Promise<void> {
  const {
    payload,
    subscriptionRowId,
    userId,
    tierSlug,
    regularPriceIls,
    newPeriodEnd,
    cardToken,
    cardExpireMonth,
    cardExpireYear,
  } = args

  if (!cardToken) {
    payload.logger.fatal(
      { subscriptionRowId },
      '[tranzilla-webhook/sto-handoff] no card token available for createstov2 — manual STO setup required',
    )
    return
  }
  if (!(regularPriceIls > 0)) {
    payload.logger.error(
      { subscriptionRowId, regularPriceIls },
      '[tranzilla-webhook/sto-handoff] missing regularPriceIls — cannot build STO payload',
    )
    return
  }

  const subsCollection = payload.db.collections['subscriptions']
  const subObjectId = new ObjectId(subscriptionRowId)

  // ─── 1. CAS claim — only one concurrent handler calls Tranzila. ────────
  const claimSentinel = `pending-handoff:${new ObjectId().toHexString()}`
  const claim = await subsCollection.updateOne(
    {
      _id: subObjectId,
      // Null-or-missing — Payload's "no value" shape. Already-handed-off
      // subs have stoId as a real string and don't match.
      $or: [{ stoId: { $exists: false } }, { stoId: null }],
    },
    { $set: { stoId: claimSentinel, updatedAt: new Date() } },
  )
  if (claim.modifiedCount !== 1) {
    payload.logger.info(
      { subscriptionRowId },
      '[tranzilla-webhook/sto-handoff] CAS skip — another handler holds the claim or stoId already set',
    )
    return
  }

  // Helper to release the sentinel if we abort. Idempotent: only clears
  // the field when it still holds *our* sentinel, so a concurrent handler
  // that somehow raced in can't be clobbered.
  //
  // On handoff failure the user has month 1 of paid access with no auto-
  // renewal. We'd rather lose that revenue than store a reusable charge
  // credential — ops gets a fatal log and either manually creates the STO
  // via Tranzila's dashboard or refunds the user.
  const releaseClaim = async (): Promise<void> => {
    await subsCollection.updateOne(
      { _id: subObjectId, stoId: claimSentinel },
      { $set: { stoId: null, updatedAt: new Date() } },
    )
  }

  const user = (await payload
    .findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true })
    .catch(() => null)) as { email?: string; name?: string } | null
  if (!user?.email) {
    payload.logger.error(
      { subscriptionRowId, userId },
      '[tranzilla-webhook/sto-handoff] user has no email — Tranzila requires client.email on createstov2',
    )
    await releaseClaim()
    return
  }

  const { tranzillaTerminalToken, tranzillaTerminal } = getPaymentEnv()
  const terminal = tranzillaTerminalToken || tranzillaTerminal

  // Tranzila POSTs to our webhook on each STO charge via a TERMINAL-level
  // notify URL configured in the My-Billing dashboard (my.tranzila.com →
  // Settings → Terminal → My-Billing). There is no per-STO notify field on
  // createstov2; attempting to pass one trips error_code 20004 "Json does
  // not match validation schema" (additionalProperties). Our sto_id
  // correlation branch in POST / handles the resulting POST — it just
  // depends on the dashboard URL being set.
  let result
  try {
    result = await createStandingOrder({
      terminalName: terminal,
      cardToken,
      cardExpireMonth,
      cardExpireYear,
      stoPaymentsNumber: STO_TOTAL_PAYMENTS_FROM_IFRAME_BOOTSTRAP,
      chargeFrequency: 'monthly',
      firstChargeDate: formatTranzilaDate(newPeriodEnd),
      chargeDayOfMonth: newPeriodEnd.getUTCDate(),
      client: {
        name: user.name ?? user.email,
        email: user.email,
      },
      items: [
        {
          itemName: `AGuy Subscription — ${tierSlug}`,
          unitPriceIls: regularPriceIls,
          quantity: 1,
        },
      ],
    })
  } catch (err) {
    payload.logger.fatal(
      {
        subscriptionRowId,
        err: err instanceof Error ? err.message : String(err),
      },
      '[tranzilla-webhook/sto-handoff] CRITICAL — createstov2 threw. User is charged + promoted but STO was not created; manual STO setup required.',
    )
    await releaseClaim()
    return
  }

  if (!result.stoId) {
    payload.logger.fatal(
      {
        subscriptionRowId,
        errorCode: result.errorCode,
        message: result.message,
        rawText: result.raw.rawText.slice(0, 500),
      },
      '[tranzilla-webhook/sto-handoff] CRITICAL — createstov2 returned no sto_id. User is charged + promoted but STO was not created; manual STO setup required.',
    )
    await releaseClaim()
    return
  }

  // ─── 2. Persist real sto_id. Rollback on DB write failure.
  //
  // Policy: no stored tokens, no stored cards. Once Tranzila's My-Billing
  // engine has the token attached to the STO, their side owns the recurring
  // charge forever — we never kept our own copy. Upgrades work via
  // /v2/sto/update items-swap, not merchant-initiated charges.
  try {
    await subsCollection.updateOne(
      { _id: subObjectId },
      {
        $set: {
          stoId: result.stoId,
          updatedAt: new Date(),
        },
      },
    )
  } catch (dbErr) {
    payload.logger.fatal(
      {
        subscriptionRowId,
        stoId: result.stoId,
        dbErr: dbErr instanceof Error ? dbErr.message : String(dbErr),
      },
      '[tranzilla-webhook/sto-handoff] CRITICAL — DB write failed after Tranzila issued sto_id. Attempting to cancel orphan STO to prevent double-charge.',
    )
    try {
      const cancelResult = await cancelStandingOrder({
        terminalName: terminal,
        stoId: result.stoId,
      })
      if (cancelResult.errorCode !== 0 && cancelResult.errorCode !== null) {
        payload.logger.fatal(
          {
            subscriptionRowId,
            stoId: result.stoId,
            errorCode: cancelResult.errorCode,
            message: cancelResult.message,
            rawText: cancelResult.rawText,
            httpStatus: cancelResult.httpStatus,
          },
          '[tranzilla-webhook/sto-handoff] ALSO failed to cancel orphan STO (non-zero error_code) — manual intervention required.',
        )
      } else {
        payload.logger.info(
          { subscriptionRowId, stoId: result.stoId },
          '[tranzilla-webhook/sto-handoff] cancelled orphan STO after DB write failure; sub remains without an STO — manual intervention required',
        )
      }
    } catch (cancelErr) {
      payload.logger.fatal(
        {
          subscriptionRowId,
          stoId: result.stoId,
          cancelErr: cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
        },
        '[tranzilla-webhook/sto-handoff] ALSO failed to cancel orphan STO (threw) — manual intervention required.',
      )
    }
    await releaseClaim()
    return
  }

  payload.logger.info(
    { subscriptionRowId, stoId: result.stoId, firstChargeDate: formatTranzilaDate(newPeriodEnd) },
    '[tranzilla-webhook/sto-handoff] STO created, token discarded, cron no longer needed for this sub',
  )
}

async function handleTranzillaSubscriptionBootstrap(
  payload: PayloadInstance,
  {
    index,
    responseCode,
    transactionRowId,
    subscriptionRowId,
    body,
    authMethod,
  }: TranzillaSubBootstrapArgs,
): Promise<void> {
  // Load sub + tx. Both must exist and both must still be pending.
  let subscription: TranzillaSubscriptionDoc | null
  try {
    subscription = (await payload.findByID({
      collection: 'subscriptions',
      id: subscriptionRowId,
      depth: 0,
      overrideAccess: true,
    })) as TranzillaSubscriptionDoc
  } catch {
    subscription = null
  }
  if (!subscription) {
    payload.logger.warn(
      { index, subscriptionRowId },
      '[tranzilla-webhook/sub-bootstrap] no Subscriptions row for u73 — bootstrap endpoint may not have persisted it before redirect',
    )
    return
  }

  // Fetch Tx up-front so the replay branch below can repair a pending Tx
  // even when the sub has already been promoted (e.g. extendTierSubscription
  // succeeded on a prior delivery but the Tx flip threw and the whole
  // request 500'd before the Tx was marked succeeded).
  let transaction: TranzillaTx | null
  try {
    transaction = (await payload.findByID({
      collection: 'transactions',
      id: transactionRowId,
      depth: 0,
      overrideAccess: true,
    })) as TranzillaTx
  } catch {
    transaction = null
  }
  if (!transaction) {
    throw new Error(
      `Subscription-bootstrap webhook (${subscriptionRowId}) could not find initial transaction ${transactionRowId}`,
    )
  }

  const userId = resolveUserId(subscription.user)
  if (!userId) {
    throw new Error(`Subscription ${subscriptionRowId} missing user — cannot bootstrap`)
  }
  const tierSlug = subscription.tierSlug
  if (!isTierSlug(tierSlug) || tierSlug === 'free') {
    throw new Error(
      `Subscription ${subscriptionRowId} has invalid tierSlug "${tierSlug ?? 'null'}" — bootstrap requires a paid tier`,
    )
  }

  const isApproved = responseCode === TRANZILLA_APPROVED_CODE

  if (!isApproved) {
    // Declined — only act on the first delivery. If the sub is already in
    // a non-pending state (e.g. extendTierSubscription succeeded on an
    // approved prior delivery but the Tx flip then threw, and now a
    // declined replay arrives for some reason), do nothing to avoid
    // demoting a user who's already paid.
    if (subscription.status === 'pending') {
      await markTransactionFailed(payload, transaction.id, index, responseCode)
      const subsCollection = payload.db.collections['subscriptions']
      await subsCollection.updateOne(
        { _id: new ObjectId(subscriptionRowId), status: 'pending' },
        {
          $set: {
            status: 'expired',
            updatedAt: new Date(),
          },
        },
      )
      payload.logger.info(
        { index, subscriptionRowId, transactionRowId, responseCode, authMethod },
        '[tranzilla-webhook/sub-bootstrap] first charge declined — tx failed, sub expired',
      )
    } else {
      payload.logger.warn(
        { index, subscriptionRowId, subStatus: subscription.status, responseCode },
        '[tranzilla-webhook/sub-bootstrap] decline arrived for non-pending sub — ignoring',
      )
    }
    return
  }

  // ─── Approved path ─────────────────────────────────────────────────────
  //
  // Handles both first delivery AND replay (unprocessed-event re-run from
  // the dedup gate) uniformly. Every step is idempotent per-period:
  //   - extendTierSubscription: CAS on currentPeriodEnd + llmTokensResetAt
  //     means a repeat call with the same newPeriodEnd no-ops both writes,
  //     but will complete a partial state if a prior delivery crashed
  //     between promoteUserForTierSub and advanceSubscriptionPeriod.
  //   - flipTransactionSucceeded: guarded on transaction.status === 'pending'.
  //
  // Period math: on the first delivery, compute `now + 1 month`. On replay
  // (sub already advanced), reuse the Sub's stored currentPeriodEnd so the
  // CAS doesn't re-fire. This keeps introChargesUsed accurate.
  //
  // TranzilaTK is passed in-memory to handoffToStandingOrder below — never
  // persisted. The handoff's own cardToken validation handles a missing
  // token (fatal log + releaseClaim).
  const now = subscription.currentPeriodStart
    ? new Date(subscription.currentPeriodStart)
    : new Date()
  const newPeriodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : addCalendarMonths(now, 1)
  const introChargesTotal = subscription.introChargesTotal ?? null
  const introChargesUsed = subscription.introChargesUsed ?? 0
  const isIntroCharge =
    subscription.introPriceIls !== null &&
    subscription.introPriceIls !== undefined &&
    introChargesTotal !== null &&
    introChargesUsed < introChargesTotal

  await extendTierSubscription({
    payload,
    userId,
    tierSlug: tierSlug as TierSlug,
    subscriptionId: subscriptionRowId,
    newPeriodStart: now,
    newPeriodEnd,
    isIntroCharge,
    order: 'bootstrap',
  })

  // Hand off to Tranzila My-Billing for the remaining recurring charges.
  // Only on first delivery (sub was pending) — replays skip because we've
  // either already set up the STO (success case) or already fell back to
  // cron (failure case), and either way the token-based retry on replay
  // would double-create.
  if (subscription.status === 'pending' && !subscription.stoId) {
    const expiry = parseCardExpiry(body)
    if (!expiry) {
      // Can't call createstov2 without card expiry. Log fatal with the full
      // key list so ops can see which fields Tranzila actually sent — the
      // field name probably just needs updating in parseCardExpiry.
      payload.logger.fatal(
        {
          subscriptionRowId,
          availableBodyKeys: Object.keys(body),
          expdateVariants: {
            expdate: body.expdate,
            expDate: body.expDate,
            expmonth: body.expmonth,
            expyear: body.expyear,
          },
        },
        '[tranzilla-webhook/sub-bootstrap] CRITICAL — no parseable card expiry in notify_url body; cannot call createstov2',
      )
    } else {
      await handoffToStandingOrder({
        payload,
        subscriptionRowId,
        userId,
        tierSlug: tierSlug as TierSlug,
        regularPriceIls: subscription.regularPriceIls ?? 0,
        newPeriodEnd,
        cardToken: body.TranzilaTK || '',
        cardExpireMonth: expiry.month,
        cardExpireYear: expiry.year,
      })
    }
  }

  // Flip only when still pending — on replay the Tx may already be
  // succeeded, and running the update through statusTransitionGuard
  // again would be noise at best and a rejection at worst.
  if (transaction.status === 'pending') {
    await flipTransactionSucceeded(payload, transaction, index, body)
  }

  // Receipt. Green Invoice issues the formal tax invoice for Tranzilla
  // flows (see purchase-receipt templates) — our email is just a
  // payment-confirmation note. Fire-and-forget. (Idempotent via emailSentAt
  // guard in the receipt service.)
  void sendPurchaseReceipt(payload, {
    transactionId: String(transaction.id),
    userId,
    productId: '', // tier sub — no product
    providerTransactionId: index,
    amount: transaction.amount,
    currency: transaction.currency,
    appliedCoupon: transaction.metadata?.appliedCoupon ?? null,
    tierSlug: tierSlug as TierSlug,
    useGreenInvoiceNote: true,
  })

  payload.logger.info(
    {
      index,
      subscriptionRowId,
      transactionRowId,
      authMethod,
      confirmationCode: body.ConfirmationCode,
    },
    '[tranzilla-webhook/sub-bootstrap] first charge approved — sub active, token stored',
  )
}

interface StoRenewalArgs {
  subscriptionId: string
  index: string
  responseCode: string
  body: Record<string, string>
  authMethod: 'response_hash' | 'unsigned'
}

/**
 * Handle a recurring STO charge POST from Tranzila's My-Billing engine.
 *
 * Called when (a) the inbound POST has no u72/u73 (not a bootstrap), and
 * (b) its `sto_id` field matches a Subscriptions row that we created at
 * handoff. Routed to from section 5 of the main handler; the dedup gate
 * has already filtered replays by `index`.
 *
 * Idempotency: safe to re-run on a replayed delivery.
 *   - extendTierSubscription CAS-guards on currentPeriodEnd + llmTokensResetAt;
 *     a repeated call with the same newPeriodEnd is a no-op.
 *   - The renewal Tx uses `providerTransactionId: index` which is unique per
 *     Tranzila charge; a duplicate-key error on retry means the Tx was
 *     already recorded on a prior delivery and we can safely continue.
 *
 * Correctness invariants:
 *   1. extendTierSubscription runs BEFORE Tx create — advancing the sub's
 *      period first makes the row ineligible for re-selection, so a Tx
 *      create failure cannot expose a double-charge vector.
 *   2. Approved charges clear past_due back to active (via extend's $set:
 *      status='active' + tranzillaRetryCount=0 inside advanceSubscriptionPeriod).
 *   3. Declines flip to past_due + increment retry count, but do NOT expire
 *      the sub here — Tranzila's My-Billing engine owns the retry cadence
 *      on their side; downgrade belongs in a separate dunning policy
 *      (Mission 5 in the mission tracker). The failure is recorded as a
 *      Transactions row for accounting + ops visibility.
 */
async function handleTranzillaStoRenewal(
  payload: PayloadInstance,
  args: StoRenewalArgs,
): Promise<void> {
  const { subscriptionId, index, responseCode, body, authMethod } = args

  let sub: TranzillaSubscriptionDoc | null
  try {
    sub = (await payload.findByID({
      collection: 'subscriptions',
      id: subscriptionId,
      depth: 0,
      overrideAccess: true,
    })) as TranzillaSubscriptionDoc
  } catch {
    sub = null
  }
  if (!sub) {
    payload.logger.warn(
      { index, subscriptionId },
      '[tranzilla-webhook/sto-renewal] sub vanished between correlation and process',
    )
    return
  }

  const tenantId = resolveTenantId(sub.tenant)
  const userId = resolveUserId(sub.user)
  if (!tenantId || !userId) {
    payload.logger.error(
      { index, subscriptionId, hasTenant: Boolean(tenantId), hasUser: Boolean(userId) },
      '[tranzilla-webhook/sto-renewal] sub missing tenant or user — cannot record renewal',
    )
    return
  }

  const tierSlug = sub.tierSlug
  if (!isTierSlug(tierSlug) || tierSlug === 'free') {
    payload.logger.error(
      { index, subscriptionId, tierSlug },
      '[tranzilla-webhook/sto-renewal] sub has invalid tier — cannot record renewal',
    )
    return
  }

  const isApproved = responseCode === TRANZILLA_APPROVED_CODE

  // Decline branch — Tranzila's My-Billing engine owns retries. We just
  // reflect state locally so UI dunning can show + ops can see the failure.
  if (!isApproved) {
    const subsCollection = payload.db.collections['subscriptions']
    await subsCollection.updateOne(
      {
        _id: new ObjectId(subscriptionId),
        status: { $in: ['active', 'past_due'] },
      },
      {
        $set: { status: 'past_due', updatedAt: new Date() },
        $inc: { tranzillaRetryCount: 1 },
      },
    )
    try {
      await payload.create({
        collection: 'transactions',
        data: {
          tenant: tenantId,
          user: userId,
          tierSlug,
          provider: 'tranzilla',
          providerTransactionId: index,
          status: 'failed',
          amount: Math.round((Number(body.sum) || 0) * 100),
          currency: 'ILS',
          isRenewal: true,
          subscription: subscriptionId,
          metadata: {
            tranzilla: { responseCode, authMethod },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        draft: false,
        overrideAccess: true,
      })
    } catch (txErr) {
      if (!isDuplicateKeyError(txErr)) {
        payload.logger.error(
          {
            err: txErr instanceof Error ? txErr.message : String(txErr),
            index,
            subscriptionId,
          },
          '[tranzilla-webhook/sto-renewal] failed to record decline Tx',
        )
      }
    }
    payload.logger.info(
      { index, subscriptionId, responseCode, authMethod },
      '[tranzilla-webhook/sto-renewal] decline recorded — sub flipped to past_due',
    )
    return
  }

  // Approved path.
  const anchor = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date()
  const newPeriodEnd = addCalendarMonths(anchor, 1)

  const { priceIls, isIntroCharge } = computeNextChargePriceIls({
    introPriceIls: sub.introPriceIls ?? null,
    introChargesTotal: sub.introChargesTotal ?? null,
    introChargesUsed: sub.introChargesUsed ?? 0,
    regularPriceIls: sub.regularPriceIls ?? 0,
  })

  await extendTierSubscription({
    payload,
    userId,
    tierSlug: tierSlug as TierSlug,
    subscriptionId,
    newPeriodStart: anchor,
    newPeriodEnd,
    isIntroCharge,
    order: 'renewal',
  })

  // Create renewal Tx row. Duplicate key = Tx was already created on a
  // prior delivery (replay path) — safe to continue.
  let renewalTxId: string | null = null
  try {
    const renewalTx = await payload.create({
      collection: 'transactions',
      data: {
        tenant: tenantId,
        user: userId,
        tierSlug,
        provider: 'tranzilla',
        providerTransactionId: index,
        status: 'succeeded',
        amount: Math.round((Number(body.sum) || priceIls) * 100),
        currency: 'ILS',
        isRenewal: true,
        isIntroCharge,
        subscription: subscriptionId,
        entitlementsGrantedAt: new Date().toISOString(),
        metadata: {
          tranzilla: {
            confirmationCode: body.ConfirmationCode ?? null,
            responseCode,
            authMethod,
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      draft: false,
      overrideAccess: true,
    })
    renewalTxId = renewalTx.id
  } catch (txErr) {
    if (isDuplicateKeyError(txErr)) {
      payload.logger.info(
        { index, subscriptionId },
        '[tranzilla-webhook/sto-renewal] renewal Tx already recorded on prior delivery — replay no-op',
      )
    } else {
      payload.logger.fatal(
        {
          err: txErr instanceof Error ? txErr.message : String(txErr),
          index,
          subscriptionId,
        },
        '[tranzilla-webhook/sto-renewal] CRITICAL — card charged + sub extended, but renewal Tx create FAILED. Reconcile manually.',
      )
      // Don't throw — sub is already extended so retrying the whole webhook
      // would advance nothing. Ops has the fatal log to repair the Tx row.
    }
  }

  // Receipt for the renewal charge. Green Invoice issues the tax invoice;
  // our email is just a payment-confirmation note. Fire-and-forget,
  // idempotent via emailSentAt. Skipped on duplicate-Tx replays because
  // renewalTxId stays null.
  if (renewalTxId) {
    void sendPurchaseReceipt(payload, {
      transactionId: renewalTxId,
      userId,
      productId: '',
      providerTransactionId: index,
      amount: Math.round((Number(body.sum) || priceIls) * 100),
      currency: 'ILS',
      appliedCoupon: null,
      tierSlug: tierSlug as TierSlug,
    })
  }

  payload.logger.info(
    {
      index,
      subscriptionId,
      tierSlug,
      priceIls,
      isIntroCharge,
      newPeriodEnd: newPeriodEnd.toISOString(),
      renewalTxId,
    },
    '[tranzilla-webhook/sto-renewal] renewal applied',
  )
}

function resolveUserId(user: TranzillaTx['user']): string | null {
  if (!user) return null
  return typeof user === 'string' ? user : user.id
}

function resolveTenantId(tenant: TranzillaSubscriptionDoc['tenant']): string | null {
  if (!tenant) return null
  return typeof tenant === 'string' ? tenant : tenant.id
}

function resolveProductId(product: TranzillaTx['product']): string | null {
  if (!product) return null
  return typeof product === 'string' ? product : product.id
}

async function markTransactionFailed(
  payload: PayloadInstance,
  transactionId: string,
  index: string,
  responseCode: string,
): Promise<void> {
  const errorMessage = `Tranzilla declined — response code ${responseCode || 'unknown'}`
  try {
    await payload.update({
      collection: 'transactions',
      id: transactionId,
      data: {
        status: 'failed',
        providerTransactionId: index,
        errorMessage,
      },
      overrideAccess: true,
    })
  } catch (err) {
    // If the real Tranzilla index collides with an existing providerTransactionId
    // (webhook replay after a successful prior run that already updated the row),
    // fall back to a status-only update so idempotent replays don't 500.
    if (isDuplicateKeyError(err)) {
      await payload.update({
        collection: 'transactions',
        id: transactionId,
        data: { status: 'failed', errorMessage },
        overrideAccess: true,
      })
      return
    }
    throw err
  }
}

async function flipTransactionSucceeded(
  payload: PayloadInstance,
  transaction: TranzillaTx,
  index: string,
  body: Record<string, string>,
): Promise<void> {
  const nowIso = new Date().toISOString()
  // Intentionally does NOT store TranzilaTK on the Transaction. The token is
  // a reusable merchant-initiated-charge credential; the Subscription row
  // is its single source of truth (field-level access.read:()=>false blocks
  // standard REST reads). Storing it on the Tx would let any admin with
  // transactions read access enumerate every stored token at once —
  // nullifying the Subscriptions guard. Keep only reconciliation fields.
  const nextMetadata = {
    ...(transaction.metadata ?? {}),
    tranzilla: {
      confirmationCode: body.ConfirmationCode ?? null,
      cardType: body.card_type ?? null,
      last4: body.last4 ?? null,
    },
  }

  try {
    await payload.update({
      collection: 'transactions',
      id: transaction.id,
      data: {
        status: 'succeeded',
        providerTransactionId: index,
        entitlementsGrantedAt: nowIso,
        metadata: nextMetadata,
      },
      overrideAccess: true,
    })
  } catch (err) {
    // Same unique-collision fallback as the failed path.
    if (isDuplicateKeyError(err)) {
      await payload.update({
        collection: 'transactions',
        id: transaction.id,
        data: {
          status: 'succeeded',
          entitlementsGrantedAt: nowIso,
          metadata: nextMetadata,
        },
        overrideAccess: true,
      })
      return
    }
    throw err
  }
}

/**
 * Consume a coupon atomically on successful payment. Mirrors the PayPal
 * handler's pattern — see src/app/api/webhooks/paypal/route.ts for the
 * full rationale (race-safe $inc, afterChange hook skip, global tenant
 * matching).
 */
async function consumeCouponIfPresent(
  payload: PayloadInstance,
  transaction: TranzillaTx,
): Promise<void> {
  const appliedCoupon = transaction.metadata?.appliedCoupon
  if (!appliedCoupon) return

  const tenantId =
    typeof transaction.tenant === 'object' && transaction.tenant
      ? transaction.tenant.id
      : (transaction.tenant as string | null | undefined)

  const coupons = await payload.find({
    collection: 'coupons',
    where: {
      code: { equals: appliedCoupon.code },
      or: [...(tenantId ? [{ tenant: { equals: tenantId } }] : []), { tenant: { exists: false } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (coupons.totalDocs === 0) {
    payload.logger.warn(
      { code: appliedCoupon.code, tenantId },
      '[tranzilla-webhook] coupon not found for consumption',
    )
    return
  }

  const coupon = coupons.docs[0] as {
    id: string
    maxUses?: number
    tenant?: string | { id: string } | null
  }
  const userId = resolveUserId(transaction.user)

  const couponsCollection = payload.db.collections['coupons']
  const filter: Record<string, unknown> = { _id: new ObjectId(coupon.id) }
  if ((coupon.maxUses ?? 0) > 0) {
    filter.$expr = { $lt: ['$usesCount', '$maxUses'] }
  }

  const result = await couponsCollection.updateOne(filter, { $inc: { usesCount: 1 } })
  if (result.modifiedCount === 0) {
    payload.logger.warn(
      { couponId: coupon.id, code: appliedCoupon.code },
      '[tranzilla-webhook] coupon exhausted — payment succeeded but coupon not consumed',
    )
    return
  }

  await payload.create({
    collection: 'coupon-usages',
    data: {
      coupon: coupon.id,
      transaction: transaction.id,
      user: userId,
      tenant:
        typeof coupon.tenant === 'object' && coupon.tenant
          ? coupon.tenant.id
          : (coupon.tenant ?? null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    context: { skipUsesCountHook: true },
    overrideAccess: true,
  })

  await payload.update({
    collection: 'transactions',
    id: transaction.id,
    data: { couponConsumedAt: new Date().toISOString() },
    overrideAccess: true,
  })
}
