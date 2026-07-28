/**
 * PayPal Webhook Handler
 *
 * POST /api/webhooks/paypal
 *
 * Verifies PayPal webhook signature, updates Transaction status, and grants
 * entitlements on successful payment. Returns 400 for bad signatures (no retry),
 * 500 for transient errors (provider will retry), and 200 for downstream
 * processing errors that should not be retried.
 *
 * @fileType api-route
 * @domain payments
 * @pattern webhook
 * @ai-summary Handles PayPal webhook events for payment confirmation and refunds
 */

import { NextRequest, NextResponse } from 'next/server'
import { ObjectId } from 'mongodb'

import { getPayload } from 'payload'
import config from '@payload-config'

import { serializePaymentError } from '@/lib/payment/error-log'
import {
  addCalendarMonths,
  extendProductEntitlements,
  grantProductEntitlements,
} from '@/lib/payment/grant-entitlements'
import { verifyPayPalWebhook } from '@/lib/payment/paypal'
import { revokeProductEntitlements } from '@/lib/payment/revoke-entitlements'
import { sendPurchaseReceipt } from '@/server/email/services/purchase-receipt-service'

interface PayPalWebhookResource {
  id: string
  supplementary_data?: {
    related_ids?: {
      order_id?: string
      subscription_id?: string
    }
  }
  // Subscription-specific fields (BILLING.SUBSCRIPTION.*)
  status?: string
  plan_id?: string
  start_time?: string
  billing_info?: {
    next_billing_time?: string
    last_payment?: { time?: string; amount?: { value?: string; currency_code?: string } }
    cycle_executions?: Array<{
      tenure_type?: string
      sequence?: number
      cycles_completed?: number
      cycles_remaining?: number
    }>
  }
  // Sale-specific fields (PAYMENT.SALE.COMPLETED / PAYMENT.SALE.REFUNDED)
  billing_agreement_id?: string
  amount?: { total?: string; currency?: string }
  custom?: string
  // PAYMENT.SALE.REFUNDED — the refund event resource is the refund itself;
  // parent_payment / sale_id point back at the original sale we recorded.
  parent_payment?: string
  sale_id?: string
}

interface PayPalWebhookEvent {
  id: string
  event_type: string
  resource: PayPalWebhookResource
}

/**
 * MongoDB duplicate-key error detection (code 11000 or E11000 in message).
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: number; message?: string; errors?: unknown[]; data?: unknown }
  if (e.code === 11000) return true
  if (/E11000|duplicate key/i.test(e.message ?? '')) return true
  // Payload CMS ValidationError: message contains "unique"
  if (/unique/i.test(e.message ?? '')) return true
  // Payload ValidationError stores errors in data.errors or directly in errors
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

  // 1. Parse body as JSON
  let body: object
  try {
    body = await request.json()
  } catch {
    const sourceIp =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const bodySnippet = request.headers.get('content-type') || ''
    payload.logger.warn({ sourceIp, bodySnippet }, 'PayPal webhook: failed to parse JSON body')
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  // 2. Extract PayPal headers for signature verification
  const headers: Record<string, string> = {
    'paypal-transmission-id': request.headers.get('paypal-transmission-id') || '',
    'paypal-transmission-time': request.headers.get('paypal-transmission-time') || '',
    'paypal-transmission-sig': request.headers.get('paypal-transmission-sig') || '',
    'paypal-cert-url': request.headers.get('paypal-cert-url') || '',
    'paypal-auth-algo': request.headers.get('paypal-auth-algo') || '',
  }

  // 3. Verify webhook signature
  try {
    const isValid = await verifyPayPalWebhook(body, headers)
    if (!isValid) {
      const sourceIp =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      const bodySnippet = JSON.stringify(body).slice(0, 100)
      payload.logger.warn(
        { sourceIp, bodySnippet },
        'PayPal webhook signature verification failed — returning 400',
      )
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
  } catch (err) {
    const sourceIp =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const bodySnippet = JSON.stringify(body).slice(0, 100)

    const errorMessage = err instanceof Error ? err.message : String(err)

    // Permanent errors (bad config or malformed headers) → 400, PayPal will not retry
    if (
      errorMessage.includes('Missing PAYPAL_WEBHOOK_ID') ||
      errorMessage.includes('Missing required PayPal webhook headers')
    ) {
      payload.logger.error(
        { err: serializePaymentError(err), sourceIp, bodySnippet },
        'PayPal webhook misconfiguration — returning 400',
      )
      return NextResponse.json({ error: 'Invalid webhook configuration' }, { status: 400 })
    }

    // Transient error (network issue calling PayPal verify API) → 500, PayPal will retry
    payload.logger.error(
      { err: serializePaymentError(err), sourceIp, bodySnippet },
      'PayPal webhook signature verification threw transient error — returning 500',
    )
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }

  // 4. Dedup gate — attempt to create WebhookEvents doc.
  // On duplicate-key error the event was already received → return 200 immediately.
  const event = body as PayPalWebhookEvent
  let webhookEventId: string | null = null
  try {
    const doc = await payload.create({
      collection: 'webhook-events',
      data: {
        provider: 'paypal',
        eventId: event.id,
        eventType: event.event_type as string,
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
        { eventId: event.id, eventType: event.event_type },
        'PayPal webhook: event already received — deduped',
      )
      return NextResponse.json({ received: true, deduped: true }, { status: 200 })
    }
    // Unexpected error — log and return 500 so provider retries
    payload.logger.error(
      { err: serializePaymentError(err), eventId: event.id },
      'PayPal webhook: unexpected error during dedup gate',
    )
    return NextResponse.json({ error: 'Dedup gate error' }, { status: 500 })
  }

  // 5. Route event by type
  try {
    await handleEvent(payload, event)
  } catch (err) {
    payload.logger.error(
      { err: serializePaymentError(err), eventType: event.event_type },
      'PayPal webhook handler error',
    )
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  // 6. Mark event as processed
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

/**
 * Consumes a coupon atomically on successful payment.
 *
 * Uses MongoDB atomic $inc with a conditional filter to prevent race conditions
 * when multiple concurrent checkouts compete for the same limited-use coupon.
 *
 * The coupon-usages row is created only if the atomic increment succeeds,
 * and the afterChange hook is skipped via context to avoid double-incrementing.
 *
 * Tenant scoping: the coupon lookup is filtered by the transaction's tenant.
 * Global (tenant-less) coupons also match — they are found via
 * `tenant: { exists: false }` in the OR clause.
 *
 * @param payload - Payload instance
 * @param transaction - The succeeded transaction with appliedCoupon in metadata
 * @param tenantId - The tenant ID to scope coupon lookup
 */
async function consumeCouponOnPayment(
  payload: Awaited<ReturnType<typeof getPayload>>,
  transaction: {
    id: string
    metadata?: {
      appliedCoupon?: {
        code: string
        discountType: string
        discountValue: number
        originalAmount?: number
        discountedAmount?: number
      }
    } | null
    user?: string | { id: string }
    product?: string | { id: string }
  },
  tenantId: string,
): Promise<void> {
  const appliedCoupon = transaction.metadata?.appliedCoupon
  if (!appliedCoupon) return

  // Find the coupon by code, scoped to the transaction's tenant.
  // Also match global (tenant-less) coupons via the OR clause.
  const coupons = await payload.find({
    collection: 'coupons',
    where: {
      code: { equals: appliedCoupon.code },
      or: [{ tenant: { equals: tenantId } }, { tenant: { exists: false } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (coupons.totalDocs === 0) {
    payload.logger.warn({ code: appliedCoupon.code, tenantId }, 'Coupon not found for consumption')
    return
  }

  const coupon = coupons.docs[0] as {
    id: string
    maxUses?: number
    usesCount?: number
    tenant?: string | { id: string } | null
  }

  const userId = typeof transaction.user === 'object' ? transaction.user.id : transaction.user

  // Atomic increment: use $inc with $expr filter to check usesCount < maxUses
  // This prevents race conditions where two concurrent payments could both pass the check
  const couponsCollection = payload.db.collections['coupons']
  const filter: Record<string, unknown> = { _id: new ObjectId(coupon.id) }

  // Only add maxUses filter if maxUses > 0 (0 means unlimited)
  if ((coupon.maxUses ?? 0) > 0) {
    filter.$expr = { $lt: ['$usesCount', '$maxUses'] }
  }

  const result = await couponsCollection.updateOne(filter, { $inc: { usesCount: 1 } })

  if (result.modifiedCount === 0) {
    // Coupon is exhausted (usesCount >= maxUses or doesn't exist)
    payload.logger.warn(
      { couponId: coupon.id, code: appliedCoupon.code },
      'Coupon exhausted — payment succeeded but coupon not consumed',
    )
    return
  }

  // Create coupon-usages row (skip the afterChange hook since we did the increment manually)
  await payload.create({
    collection: 'coupon-usages',
    data: {
      coupon: coupon.id,
      transaction: transaction.id,
      user: userId,
      tenant: coupon.tenant ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    context: { skipUsesCountHook: true },
    overrideAccess: true,
  })

  payload.logger.info(
    { couponId: coupon.id, code: appliedCoupon.code, transactionId: transaction.id },
    'Coupon consumed atomically on payment success',
  )
}

async function handleEvent(
  payload: Awaited<ReturnType<typeof getPayload>>,
  event: PayPalWebhookEvent,
): Promise<void> {
  switch (event.event_type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      const orderId = event.resource.id

      const transactions = await payload.find({
        collection: 'transactions',
        where: {
          providerTransactionId: { equals: orderId },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })

      if (transactions.totalDocs === 0) {
        payload.logger.warn({ orderId }, 'PayPal webhook: transaction not found')
        return
      }

      const transaction = transactions.docs[0]

      // Idempotency: skip if entitlements already granted (replayed webhook)
      if (transaction.entitlementsGrantedAt) {
        return
      }

      // Entitlements are granted only on PAYMENT.CAPTURE.COMPLETED (when funds are actually captured).
      // CHECKOUT.ORDER.APPROVED only validates the order exists and returns success.
      break
    }

    case 'PAYMENT.CAPTURE.COMPLETED': {
      // The capture ID is in resource.id, but we need the order ID to find the transaction.
      // Try to get the order ID from supplementary_data.related_ids.order_id
      const orderId = event.resource.supplementary_data?.related_ids?.order_id || event.resource.id
      const captureId = event.resource.id

      const transactions = await payload.find({
        collection: 'transactions',
        where: {
          providerTransactionId: { equals: orderId },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })

      if (transactions.totalDocs === 0) {
        payload.logger.warn(
          { orderId },
          'PayPal webhook: transaction not found for PAYMENT.CAPTURE.COMPLETED',
        )
        return
      }

      const transaction = transactions.docs[0]

      // Idempotency: skip if entitlements already granted (replayed webhook)
      if (!transaction.entitlementsGrantedAt) {
        // Grant entitlements BEFORE flipping status to succeeded — fail-safe:
        // if grant throws we do NOT set status=succeeded so the provider retries.
        await grantProductEntitlements(
          transaction.user as string,
          transaction.product as string,
          String(transaction.id),
        )

        // Grant succeeded — atomically flip status and record the grant timestamp and captureId
        await payload.update({
          collection: 'transactions',
          id: transaction.id,
          data: {
            status: 'succeeded',
            entitlementsGrantedAt: new Date().toISOString(),
            captureId,
          },
          overrideAccess: true,
        })
      }

      // Coupon consumption — independent from entitlementsGrantedAt, idempotent via couponConsumedAt.
      // Attempt consumption if couponConsumedAt is null (regardless of entitlementsGrantedAt).
      const paypalTxMetadata = transaction.metadata as
        | {
            appliedCoupon?: {
              code: string
              discountType: string
              discountValue: number
              originalAmount?: number
              discountedAmount?: number
            } | null
          }
        | null
        | undefined
      if (!transaction.couponConsumedAt && paypalTxMetadata?.appliedCoupon) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await consumeCouponOnPayment(payload, transaction as any, transaction.tenant as string)
        } catch (err) {
          payload.logger.error(
            { err: serializePaymentError(err), transactionId: transaction.id },
            'Coupon consumption failed — returning 500 so provider retries',
          )
          throw err
        }
        await payload.update({
          collection: 'transactions',
          id: transaction.id,
          data: { couponConsumedAt: new Date().toISOString() },
          overrideAccess: true,
        })
      }

      // Send purchase receipt email — fire-and-forget.
      // sendPurchaseReceipt handles idempotency (skips if emailSentAt already set),
      // handles missing email adapter (no-op fallback), and logs errors without throwing.
      void sendPurchaseReceipt(payload, {
        transactionId: transaction.id,
        userId: typeof transaction.user === 'object' ? transaction.user.id : transaction.user,
        productId:
          typeof transaction.product === 'object' ? transaction.product.id : transaction.product,
        providerTransactionId: transaction.providerTransactionId,
        amount: transaction.amount as number,
        currency: transaction.currency as string,
        appliedCoupon: paypalTxMetadata?.appliedCoupon ?? null,
      })
      break
    }

    case 'PAYMENT.CAPTURE.REFUNDED': {
      const captureId = event.resource.id

      // Primary lookup via captureId (populated on PAYMENT.CAPTURE.COMPLETED)
      const transactions = await payload.find({
        collection: 'transactions',
        where: {
          captureId: { equals: captureId },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })

      if (transactions.totalDocs === 0) {
        // Fallback for legacy transactions created before captureId was added.
        // These have providerTransactionId set to the capture ID value (before the bug was fixed).
        const fallback = await payload.find({
          collection: 'transactions',
          where: {
            providerTransactionId: { equals: captureId },
          },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        })
        if (fallback.totalDocs === 0) {
          payload.logger.warn(
            { captureId },
            'PayPal webhook: transaction not found for PAYMENT.CAPTURE.REFUNDED',
          )
          return
        }
        await payload.update({
          collection: 'transactions',
          id: fallback.docs[0].id,
          data: { status: 'refunded' },
          overrideAccess: true,
        })
        break
      }

      await payload.update({
        collection: 'transactions',
        id: transactions.docs[0].id,
        data: { status: 'refunded' },
        overrideAccess: true,
      })
      break
    }

    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      await handleSubscriptionActivated(payload, event)
      break
    }

    case 'PAYMENT.SALE.COMPLETED': {
      await handleSubscriptionRenewal(payload, event)
      break
    }

    case 'PAYMENT.SALE.REFUNDED': {
      await handleSaleRefunded(payload, event)
      break
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      await updateSubscriptionState(payload, event, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelAtPeriodEnd: true,
      })
      break
    }

    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      await updateSubscriptionState(payload, event, { status: 'suspended' })
      break
    }

    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      await handleSubscriptionExpired(payload, event)
      break
    }

    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      await updateSubscriptionState(payload, event, { status: 'past_due' })
      break
    }

    default:
      // Unhandled event type — acknowledge without processing
      break
  }
}

/**
 * Look up a Subscription by its PayPal subscription ID. Returns null (with a
 * warn log) if not found — most likely a stray webhook for a subscription
 * created outside our checkout flow, or one that predates this collection.
 */
async function findSubscriptionByPaypalId(
  payload: Awaited<ReturnType<typeof getPayload>>,
  paypalSubscriptionId: string,
  eventType: string,
): Promise<{
  id: string
  status: string
  user: string | { id: string }
  product: string | { id: string }
  initialTransaction?: string | { id: string } | null
  tenant?: string | { id: string } | null
} | null> {
  const found = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { paypalSubscriptionId: { equals: paypalSubscriptionId } },
        { provider: { equals: 'paypal' } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (found.totalDocs === 0) {
    payload.logger.warn(
      { paypalSubscriptionId, eventType },
      'PayPal webhook: subscription not found — ignoring',
    )
    return null
  }
  return found.docs[0] as {
    id: string
    status: string
    user: string | { id: string }
    product: string | { id: string }
    initialTransaction?: string | { id: string } | null
    tenant?: string | { id: string } | null
  }
}

function resolveId(rel: string | { id: string } | null | undefined): string | null {
  if (!rel) return null
  return typeof rel === 'string' ? rel : rel.id
}

/**
 * Convert an ISO period-end string from PayPal into an interval-in-months
 * estimate. We use the product's declared `interval` (`month` / `year`) as
 * ground truth; the webhook's `next_billing_time` is only used to set the
 * period boundaries on the Subscription record.
 */
async function getProductIntervalMonths(
  payload: Awaited<ReturnType<typeof getPayload>>,
  productId: string,
): Promise<number> {
  const product = await payload.findByID({
    collection: 'products',
    id: productId,
    depth: 0,
    overrideAccess: true,
  })
  const interval = (product as { interval?: string }).interval
  if (interval === 'year') return 12
  if (interval === 'month') return 1
  // Missing/unknown interval on a subscription product is a data-quality bug
  // (schema requires it; a direct-Mongo write could bypass the validator).
  // THROW rather than defaulting: an annual PayPal plan silently granting
  // only one month of access per renewal is a customer-facing bug. Returning
  // 500 to PayPal triggers webhook retries and surfaces the misconfiguration
  // in ops alerts instead of degrading access silently.
  payload.logger.error(
    { productId, interval },
    'getProductIntervalMonths: subscription product missing/unknown interval — refusing to guess. Fix the product row and PayPal will retry.',
  )
  throw new Error(
    `Subscription product ${productId} has missing/unknown interval (${interval ?? 'undefined'}). Cannot compute renewal period.`,
  )
}

async function handleSubscriptionActivated(
  payload: Awaited<ReturnType<typeof getPayload>>,
  event: PayPalWebhookEvent,
): Promise<void> {
  const paypalSubscriptionId = event.resource.id
  const subscription = await findSubscriptionByPaypalId(
    payload,
    paypalSubscriptionId,
    event.event_type,
  )
  if (!subscription) return

  // Idempotency — replayed activation
  if (subscription.status === 'active') return

  // Refuse to resurrect terminal subscriptions. A late ACTIVATED landing
  // after CANCELLED/EXPIRED (backlog after network partition — PayPal's
  // delivery is best-effort, not causally ordered) would otherwise flip
  // the sub back to active and, via grantProductEntitlements, silently
  // reactivate the cancelled enrollment. The performEnrollmentUpdate
  // guard is a second line of defense against the same-tx replay case.
  if (subscription.status === 'cancelled' || subscription.status === 'expired') {
    payload.logger.warn(
      { paypalSubscriptionId, subscriptionStatus: subscription.status },
      'PayPal webhook: BILLING.SUBSCRIPTION.ACTIVATED for terminal subscription — ignoring',
    )
    return
  }

  const userId = resolveId(subscription.user)
  const productId = resolveId(subscription.product)
  const initialTxId = resolveId(subscription.initialTransaction)
  if (!userId || !productId) {
    payload.logger.warn(
      { paypalSubscriptionId, subscriptionId: subscription.id },
      'PayPal webhook: subscription missing user/product — cannot activate',
    )
    return
  }

  const intervalMonths = await getProductIntervalMonths(payload, productId)
  const periodStart =
    event.resource.start_time ??
    event.resource.billing_info?.last_payment?.time ??
    new Date().toISOString()
  // Prefer PayPal's next_billing_time (authoritative) for the sub period end;
  // fall back to a calendar-computed value so the Subscription row always has
  // an end date even when PayPal omits the field. Use `||` (not `??`) so an
  // empty-string next_billing_time also triggers the fallback — otherwise an
  // empty string would land as overrideExpiresAt and the enrollment would be
  // written as lifetime (grant-entitlements skips the write when expiresAt
  // is falsy).
  const periodEnd =
    event.resource.billing_info?.next_billing_time ||
    addCalendarMonths(new Date(), intervalMonths).toISOString()

  // Compute the enrollment expiry from the same period-end value. Passing
  // `overrideExpiresAt` explicitly bypasses grantProductEntitlements' default
  // durationDays computation, which is not applicable to subscriptions
  // (durationDays is forbidden on sub products by Products.beforeValidate).
  // Without this, the enrollment would be created with expiresAt: null
  // (lifetime), and revoke-on-EXPIRED would fail to find the enrollment
  // because metadata.paymentId is never rotated on renewals for lifetime
  // rows the same way.
  const overrideExpiresAt = periodEnd

  if (initialTxId) {
    await grantProductEntitlements(userId, productId, String(initialTxId), overrideExpiresAt)
    await payload.update({
      collection: 'transactions',
      id: initialTxId,
      data: {
        status: 'succeeded',
        entitlementsGrantedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
  } else {
    payload.logger.warn(
      { subscriptionId: subscription.id },
      'PayPal webhook: subscription missing initialTransaction; skipping tx-update but still granting entitlements against subscription.id',
    )
    await grantProductEntitlements(userId, productId, String(subscription.id), overrideExpiresAt)
  }

  // Status-filtered updateOne mirrors handleSubscriptionRenewal's final
  // write. Closes the race where CANCELLED/EXPIRED lands between our
  // status read at handler entry and this final activate write. If the
  // sub has become terminal in the interim, we skip the update — the
  // grant already ran (best-effort), but the sub row correctly reflects
  // the user's terminal state.
  const subscriptionsCollection = payload.db.collections['subscriptions']
  const activateResult = await subscriptionsCollection.updateOne(
    {
      _id: new ObjectId(subscription.id),
      status: { $in: ['pending', 'suspended'] },
    },
    {
      $set: {
        status: 'active',
        currentPeriodStart: new Date(periodStart),
        currentPeriodEnd: new Date(periodEnd),
      },
    },
  )
  if (activateResult.matchedCount === 0) {
    payload.logger.warn(
      { paypalSubscriptionId, subscriptionId: subscription.id },
      'PayPal webhook: concurrent CANCELLED/EXPIRED landed during ACTIVATED — leaving sub in terminal state',
    )
  }

  // Fire-and-forget receipt — only sent when we have a valid initial Tx.
  // sendPurchaseReceipt does an internal findByID on the transactions
  // collection using the transactionId we pass; the fallback path (no
  // initialTransaction) has no valid tx to look up and would trigger a
  // NotFound throw inside the voided call, surfacing as an unhandled
  // promise rejection. The fallback is a data-integrity anomaly (Web
  // should always link initialTransaction) — log it so ops can chase
  // the missing link, and skip the receipt rather than crash silently.
  if (initialTxId) {
    const tx = await payload.findByID({
      collection: 'transactions',
      id: initialTxId,
      depth: 0,
      overrideAccess: true,
    })
    void sendPurchaseReceipt(payload, {
      transactionId: initialTxId,
      userId,
      productId,
      providerTransactionId:
        (tx as { providerTransactionId?: string }).providerTransactionId ?? event.resource.id,
      amount: (tx as { amount?: number }).amount ?? 0,
      currency: (tx as { currency?: string }).currency ?? 'ILS',
      appliedCoupon: null,
    })
  } else {
    payload.logger.warn(
      { subscriptionId: subscription.id, userId, productId },
      'PayPal webhook: fallback activation path skipping receipt — subscription has no initialTransaction to base the email on. Web should always populate initialTransaction; investigate the missing link.',
    )
  }
}

async function handleSubscriptionRenewal(
  payload: Awaited<ReturnType<typeof getPayload>>,
  event: PayPalWebhookEvent,
): Promise<void> {
  // Recurring sales carry the parent subscription in billing_agreement_id
  // (classic v1 name) or supplementary_data.related_ids.subscription_id (v2).
  // If neither is present this is a non-subscription sale — ignore.
  const paypalSubscriptionId =
    event.resource.billing_agreement_id ??
    event.resource.supplementary_data?.related_ids?.subscription_id ??
    null
  if (!paypalSubscriptionId) return

  const saleId = event.resource.id
  const subscription = await findSubscriptionByPaypalId(
    payload,
    paypalSubscriptionId,
    event.event_type,
  )
  if (!subscription) return

  // Refuse to resurrect terminal subscriptions. A late/stale PAYMENT.SALE.COMPLETED
  // that lands after EXPIRED/CANCELLED would otherwise re-activate the sub,
  // extend the (already cancelled) enrollment, and rotate metadata.paymentId —
  // contradicting the terminal state that handleSubscriptionExpired /
  // handleSubscriptionCancelled deliberately established. past_due and
  // suspended are non-terminal (a successful sale legitimately clears them),
  // so we allow those through.
  if (subscription.status === 'expired' || subscription.status === 'cancelled') {
    payload.logger.warn(
      { paypalSubscriptionId, saleId, subscriptionStatus: subscription.status },
      'PayPal webhook: PAYMENT.SALE.COMPLETED for terminal subscription — ignoring',
    )
    return
  }

  const userId = resolveId(subscription.user)
  const productId = resolveId(subscription.product)
  const tenantId = resolveId(subscription.tenant)
  if (!userId || !productId) {
    payload.logger.warn(
      { paypalSubscriptionId, subscriptionId: subscription.id },
      'PayPal webhook: renewal target subscription missing user/product',
    )
    return
  }

  // Guard against non-numeric amount strings — a malformed payload would
  // otherwise pass NaN into payload.create and 500 the whole handler.
  const rawAmount = event.resource.amount?.total
  const parsedAmount = rawAmount !== undefined ? parseFloat(rawAmount) : NaN
  if (rawAmount !== undefined && !Number.isFinite(parsedAmount)) {
    payload.logger.warn(
      { paypalSubscriptionId, saleId, rawAmount },
      'PayPal webhook: PAYMENT.SALE.COMPLETED amount.total is not a valid number — falling back to 0',
    )
  }
  const amountValue = Number.isFinite(parsedAmount) ? Math.round(parsedAmount * 100) : 0
  const currency = event.resource.amount?.currency ?? 'ILS'

  // Look up or create the renewal Tx. Idempotency keys on
  // `entitlementsGrantedAt` (like the CAPTURE.COMPLETED handler) rather than
  // Tx-existence, so a webhook re-delivery after a failed extension can
  // resume from a pending Tx instead of silently short-circuiting.
  const existing = await payload.find({
    collection: 'transactions',
    where: { providerTransactionId: { equals: saleId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  let renewalTx: { id: string; entitlementsGrantedAt?: string | null }
  if (existing.totalDocs > 0) {
    renewalTx = existing.docs[0] as { id: string; entitlementsGrantedAt?: string | null }
    if (renewalTx.entitlementsGrantedAt) {
      // Fully processed already — no-op.
      return
    }
  } else {
    try {
      renewalTx = (await payload.create({
        collection: 'transactions',
        data: {
          tenant: tenantId,
          user: userId,
          product: productId,
          provider: 'paypal',
          providerTransactionId: saleId,
          captureId: saleId,
          status: 'pending',
          amount: amountValue,
          currency,
          subscription: subscription.id,
          isRenewal: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        overrideAccess: true,
      })) as { id: string; entitlementsGrantedAt?: string | null }
    } catch (err) {
      // Only treat duplicate-key as a legitimate concurrent-renewal race.
      // Any other error (network flake, validator failure, status guard
      // rejection) must rethrow — otherwise an unrelated failure that
      // coincides with a pre-existing matching row would be silently
      // masked as a successful "resume".
      if (!isDuplicateKeyError(err)) throw err

      const race = await payload.find({
        collection: 'transactions',
        where: { providerTransactionId: { equals: saleId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (race.totalDocs === 0) throw err
      renewalTx = race.docs[0] as { id: string; entitlementsGrantedAt?: string | null }
      if (renewalTx.entitlementsGrantedAt) return
    }
  }

  const intervalMonths = await getProductIntervalMonths(payload, productId)
  // Grant BEFORE flipping to succeeded — if extend throws, the Tx stays
  // pending and the next webhook re-delivery retries the extension.
  const { maxEnrollmentEndMs } = await extendProductEntitlements(
    userId,
    productId,
    String(renewalTx.id),
    intervalMonths,
  )

  const nowIso = new Date().toISOString()
  await payload.update({
    collection: 'transactions',
    id: renewalTx.id,
    data: {
      status: 'succeeded',
      entitlementsGrantedAt: nowIso,
    },
    overrideAccess: true,
  })

  // Out-of-order webhook delivery: if SALE.COMPLETED lands before ACTIVATED,
  // we need to flip the pending initial transaction to succeeded too — the
  // ACTIVATED handler will short-circuit later on subscription.status ===
  // 'active' and would otherwise leave the initial Tx stuck in pending.
  //
  // We also re-run grantProductEntitlements against the initial Tx here so
  // enrollment.metadata.paymentId points at the initial Tx (matching what
  // the ACTIVATED path would have set), preserving the invariant that an
  // admin refund of the initial Tx cleanly revokes access. Passing the
  // just-computed period end as overrideExpiresAt makes the expiresAt write
  // a no-op — only the paymentId rotation matters here.
  if (subscription.status === 'pending') {
    const initialTxId = resolveId(subscription.initialTransaction)
    if (initialTxId) {
      const initialTx = await payload.findByID({
        collection: 'transactions',
        id: initialTxId,
        depth: 0,
        overrideAccess: true,
      })
      if ((initialTx as { status?: string }).status === 'pending') {
        const overrideExpiresAt =
          maxEnrollmentEndMs > 0
            ? new Date(maxEnrollmentEndMs).toISOString()
            : addCalendarMonths(new Date(), intervalMonths).toISOString()
        await grantProductEntitlements(userId, productId, String(initialTxId), overrideExpiresAt)
        await payload.update({
          collection: 'transactions',
          id: initialTxId,
          data: {
            status: 'succeeded',
            entitlementsGrantedAt: nowIso,
          },
          overrideAccess: true,
        })
      }
    }
  }

  // Derive currentPeriodEnd from the just-extended enrollment expiries so
  // Subscription.currentPeriodEnd stays in lockstep with Enrollment.expiresAt.
  // The ACTIVATED path prefers PayPal's next_billing_time, but SALE events
  // don't carry it — falling back on the enrollment-derived value keeps the
  // two rows consistent instead of drifting apart cycle by cycle.
  const nextEndIso =
    maxEnrollmentEndMs > 0
      ? new Date(maxEnrollmentEndMs).toISOString()
      : addCalendarMonths(new Date(), intervalMonths).toISOString()

  // Status-filtered update to close the race where a concurrent CANCELLED
  // webhook lands between our status read (at handler entry) and this final
  // write. Without the filter, the write would resurrect a cancelled sub to
  // active. If the sub is now terminal, we skip the update entirely — the
  // renewal Tx is already succeeded and the enrollment is already extended
  // (the user paid for the period), but the sub row remains cancelled to
  // reflect the user's actual state.
  const subscriptionsCollection = payload.db.collections['subscriptions']
  const result = await subscriptionsCollection.updateOne(
    {
      _id: new ObjectId(subscription.id),
      status: { $in: ['pending', 'active', 'past_due', 'suspended'] },
    },
    {
      $set: {
        status: 'active',
        currentPeriodStart: new Date(nowIso),
        currentPeriodEnd: new Date(nextEndIso),
      },
    },
  )
  if (result.matchedCount === 0) {
    payload.logger.warn(
      { paypalSubscriptionId, saleId, subscriptionId: subscription.id },
      'PayPal webhook: concurrent CANCELLED/EXPIRED landed during renewal — leaving sub in terminal state (enrollment still extended, renewal tx still succeeded)',
    )
  }

  void sendPurchaseReceipt(payload, {
    transactionId: renewalTx.id,
    userId,
    productId,
    providerTransactionId: saleId,
    amount: amountValue,
    currency,
    appliedCoupon: null,
  })
}

/**
 * PAYMENT.SALE.REFUNDED — PayPal Billing v1 refund event, fired for
 * refunded subscription renewals. v2 CAPTURE.REFUNDED does not cover
 * recurring sales.
 *
 * Flips the Transaction status to `refunded`; the existing
 * revokeEntitlementsOnRefund afterChange hook on Transactions handles the
 * entitlement rollback.
 */
async function handleSaleRefunded(
  payload: Awaited<ReturnType<typeof getPayload>>,
  event: PayPalWebhookEvent,
): Promise<void> {
  // parent_payment (v1) / sale_id (v2 fallback) point at the ORIGINAL sale
  // we recorded. Do NOT fall back to event.resource.id — that's the refund's
  // own id and would never match any providerTransactionId we stored.
  const parentSaleId = event.resource.parent_payment ?? event.resource.sale_id
  if (!parentSaleId) {
    payload.logger.warn(
      { eventId: event.id },
      'PayPal webhook: PAYMENT.SALE.REFUNDED without parent_payment/sale_id — cannot locate transaction',
    )
    return
  }

  const found = await payload.find({
    collection: 'transactions',
    where: { providerTransactionId: { equals: parentSaleId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (found.totalDocs === 0) {
    payload.logger.warn(
      { parentSaleId, eventId: event.id },
      'PayPal webhook: PAYMENT.SALE.REFUNDED for unknown transaction — ignoring',
    )
    return
  }

  const tx = found.docs[0] as { id: string; status: string }
  if (tx.status === 'refunded') return // idempotent

  await payload.update({
    collection: 'transactions',
    id: tx.id,
    data: { status: 'refunded' },
    overrideAccess: true,
  })
}

async function updateSubscriptionState(
  payload: Awaited<ReturnType<typeof getPayload>>,
  event: PayPalWebhookEvent,
  update: Record<string, unknown>,
): Promise<void> {
  const subscription = await findSubscriptionByPaypalId(
    payload,
    event.resource.id,
    event.event_type,
  )
  if (!subscription) return
  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: update,
    overrideAccess: true,
  })
}

async function handleSubscriptionExpired(
  payload: Awaited<ReturnType<typeof getPayload>>,
  event: PayPalWebhookEvent,
): Promise<void> {
  const subscription = await findSubscriptionByPaypalId(
    payload,
    event.resource.id,
    event.event_type,
  )
  if (!subscription) return

  const userId = resolveId(subscription.user)
  if (!userId) {
    payload.logger.warn(
      { subscriptionId: subscription.id },
      'PayPal webhook: expired sub missing user; skipping revoke',
    )
    await payload.update({
      collection: 'subscriptions',
      id: subscription.id,
      data: { status: 'expired' },
      overrideAccess: true,
    })
    return
  }

  // Revoke against EVERY succeeded transaction tied to this sub — belt and
  // suspenders. Different grants may have anchored on different tx IDs
  // (extendEnrollment rotates metadata.paymentId per renewal for expiring
  // enrollments; lifetime enrollments also rotate now, but a legacy
  // enrollment might still be anchored on the initial tx). Revoking against
  // all of them cleans up regardless. revokeProductEntitlements is idempotent
  // and a no-op for already-cancelled enrollments.
  // pagination: false — a long-running sub could have >100 renewals (annual
  // over 10y, monthly over 8y). Silently skipping older rows would leave
  // pre-cap feature entitlement grants (each pushed under its own renewal
  // tx id) un-revoked. Matches the same choice in revokeProductEntitlements.
  const succeededTxs = await payload.find({
    collection: 'transactions',
    where: {
      and: [{ subscription: { equals: subscription.id } }, { status: { equals: 'succeeded' } }],
    },
    sort: '-createdAt',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const txIds = succeededTxs.docs.map((t) => String((t as { id: string }).id))
  const initialTxId = resolveId(subscription.initialTransaction)
  if (initialTxId && !txIds.includes(String(initialTxId))) {
    txIds.push(String(initialTxId))
  }
  // Also revoke against the subscription's own ID — covers the fallback in
  // handleSubscriptionActivated where a subscription without an
  // initialTransaction gets its entitlements granted under `subscription.id`
  // as a synthetic paymentId. Without this the fallback-granted enrollment
  // leaks through EXPIRED.
  txIds.push(String(subscription.id))

  for (const txId of txIds) {
    await revokeProductEntitlements({ payload, userId, transactionId: txId })
  }

  await payload.update({
    collection: 'subscriptions',
    id: subscription.id,
    data: { status: 'expired' },
    overrideAccess: true,
  })
}
