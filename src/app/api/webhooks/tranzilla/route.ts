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
import { verifyTranzillaWebhook } from '@/lib/payment/tranzilla'
import { isTierSlug, type TierSlug } from '@/lib/tiers/constants'
import { sendPurchaseReceipt } from '@/server/email/services/purchase-receipt-service'

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
  // When TRANZILLA_PRIVATE_KEY is configured (any non-dev environment), the
  // webhook is REQUIRED to carry a valid response_hash. Early iterations
  // allowed an unsigned log-and-accept fallback for the one-time flow, but
  // the subscription-bootstrap branch writes a reusable card token and
  // promotes a user tier, so an unsigned POST with a guessed subscription
  // id would be a direct privilege-escalation path. The fallback stays
  // available only when the private key env is absent (local dev / sandbox
  // without the signing feature enabled on the terminal).
  const hasHash = typeof body.response_hash === 'string' && body.response_hash.length > 0
  const privateKeyConfigured = Boolean(process.env.TRANZILLA_PRIVATE_KEY)
  let authMethod: 'response_hash' | 'unsigned' = 'unsigned'

  if (privateKeyConfigured && !hasHash) {
    const sourceIp =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    payload.logger.warn(
      { sourceIp, index: body.index },
      '[tranzilla-webhook] missing response_hash while private key is configured — rejecting',
    )
    return NextResponse.json({ error: 'response_hash required' }, { status: 401 })
  }

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

  // Raw-dashboard charges (manual Tranzilla admin, no u72) land here. Log
  // the payload shape and ack — not our transaction to process.
  if (!transactionRowId) {
    payload.logger.info(
      {
        authMethod,
        index,
        responseCode,
        sum: body.sum,
        currency: body.currency,
        confirmationCode: body.ConfirmationCode,
        hasToken: Boolean(body.TranzilaTK),
      },
      '[tranzilla-webhook] no u72 correlation — logging unassociated charge',
    )
    return NextResponse.json({ received: true, unassociated: true }, { status: 200 })
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
      payload.logger.info(
        { index, responseCode },
        '[tranzilla-webhook] event already received — deduped',
      )
      return NextResponse.json({ received: true, deduped: true }, { status: 200 })
    }
    payload.logger.error(
      { err: serializePaymentError(err), index },
      '[tranzilla-webhook] unexpected error during dedup gate',
    )
    return NextResponse.json({ error: 'Dedup gate error' }, { status: 500 })
  }

  // ─── 5. Process the transaction ─────────────────────────────────────────
  try {
    if (subscriptionRowId) {
      // Subscription-bootstrap path (first charge against the hosted iframe
      // with the token terminal). Captures TranzilaTK, flips sub to active,
      // and promotes the user via extendTierSubscription.
      await handleTranzillaSubscriptionBootstrap(payload, {
        index,
        responseCode,
        transactionRowId,
        subscriptionRowId,
        body,
        authMethod,
      })
    } else {
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
  user: string | { id: string } | null
  tierSlug?: string | null
  status: string
  introPriceIls?: number | null
  introChargesTotal?: number | null
  introChargesUsed?: number | null
  regularPriceIls?: number | null
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

  if (subscription.status !== 'pending') {
    // Replay: sub already promoted. The only lingering work is to make sure
    // the initial Tx reached a terminal state — a mid-run crash on the
    // happy path can leave extendTierSubscription applied but Tx still
    // pending, which breaks reconciliation and the admin UI's purchase row.
    if (transaction.status === 'pending' && responseCode === TRANZILLA_APPROVED_CODE) {
      await flipTransactionSucceeded(payload, transaction, index, body)
      payload.logger.info(
        { index, subscriptionRowId, transactionRowId },
        '[tranzilla-webhook/sub-bootstrap] replay: sub already active, flipped stale pending Tx to succeeded',
      )
    } else {
      payload.logger.info(
        {
          index,
          subscriptionRowId,
          currentStatus: subscription.status,
          txStatus: transaction.status,
        },
        '[tranzilla-webhook/sub-bootstrap] subscription already in a non-pending state — idempotent replay',
      )
    }
    return
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
    // Bootstrap failed — mark tx failed and sub expired so the user can start fresh.
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
    return
  }

  // ─── Approved path ─────────────────────────────────────────────────────
  const token = body.TranzilaTK || null
  if (!token) {
    // No token means the next cron run has nothing to charge. Treat as a
    // bootstrap failure rather than silently moving on — ops will see the
    // error and can investigate the terminal config (fxpaguytok missing?).
    throw new Error(
      `Subscription-bootstrap webhook (${subscriptionRowId}) succeeded without a TranzilaTK — terminal must be the tokenization terminal`,
    )
  }

  // Snapshot the token + card metadata onto the Sub row before promoting.
  const subsCollection = payload.db.collections['subscriptions']
  await subsCollection.updateOne(
    { _id: new ObjectId(subscriptionRowId) },
    {
      $set: {
        tranzillaCardToken: token,
        updatedAt: new Date(),
      },
    },
  )

  const now = new Date()
  const newPeriodEnd = addCalendarMonths(now, 1)
  // isIntroCharge is derived from the Sub's snapshotted intro state. On
  // the very first charge, introChargesUsed is 0 — if the offer has an
  // intro cycle configured, this charge is one of them.
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
  })

  await flipTransactionSucceeded(payload, transaction, index, body)

  // Receipt. Green Invoice issues the formal tax invoice for Tranzilla
  // flows (see purchase-receipt templates) — our email is just a
  // payment-confirmation note. Fire-and-forget.
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

function resolveUserId(user: TranzillaTx['user']): string | null {
  if (!user) return null
  return typeof user === 'string' ? user : user.id
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
  const nextMetadata = {
    ...(transaction.metadata ?? {}),
    tranzilla: {
      confirmationCode: body.ConfirmationCode ?? null,
      cardType: body.card_type ?? null,
      last4: body.last4 ?? null,
      token: body.TranzilaTK || null,
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
