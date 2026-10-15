/**
 * Purchase Receipt Email Service
 *
 * Sends a templated purchase receipt email to the user after successful payment.
 * Implements a no-op fallback when no email adapter is configured so dev/test
 * environments do not fail — the payment and entitlement grant must never roll
 * back due to email failure.
 *
 * Idempotency: if emailSentAt is already set on the transaction, skips sending.
 *
 * @fileType service
 * @domain email
 * @pattern purchase-receipt
 * @ai-summary Sends purchase receipt emails after successful payment webhooks
 */

import type { Payload } from 'payload'

import { TIER_LABEL_EN, TIER_LABEL_HE, type TierSlug } from '@/lib/tiers/constants'
import {
  buildPurchaseReceiptEmailEN,
  buildPurchaseReceiptEmailHE,
  type PurchaseReceiptData,
} from '../templates/purchase-receipt'

const PURCHASES_URL = '/account/purchases'

export interface SendPurchaseReceiptOptions {
  transactionId: string
  // Empty string when this is a tier subscription (no product row). Callers
  // in the tier-subscription path pass `tierSlug` instead, and the template
  // uses the localized tier label as the line-item name.
  userId: string
  productId: string
  providerTransactionId: string
  amount: number
  currency: string
  userLocale?: string
  appliedCoupon?: {
    code: string
    discountType: string
    discountValue: number
    originalAmount?: number
    discountedAmount?: number
  } | null
  // Tier-subscription receipts set this so the template can render the
  // localized tier name without a Products lookup.
  tierSlug?: TierSlug
  // Tranzilla path: Green Invoice issues the formal tax receipt separately,
  // so our email is a payment-confirmation note. Toggles the extra line in
  // both locales.
  useGreenInvoiceNote?: boolean
}

/**
 * Renders an email template to an HTML string.
 */
function renderEmailTemplate(locale: string, data: PurchaseReceiptData): string {
  if (locale === 'he') {
    return buildPurchaseReceiptEmailHE(data)
  }
  return buildPurchaseReceiptEmailEN(data)
}

/**
 * Formats a coupon discount value for display in the email.
 */
function formatCouponDiscount(discountType: string, discountValue: number): string {
  if (discountType === 'percentage') {
    return `${discountValue}%`
  }
  if (discountType === 'fixed') {
    return `$${(discountValue / 100).toFixed(2)}`
  }
  return `${discountValue}`
}

/**
 * Sends a purchase receipt email for a successful transaction.
 *
 * @param payload - Payload CMS instance (provides logger and Local API)
 * @param options - Transaction and user details needed to render the receipt
 * @returns true if email was (or already was) sent; false on error (caller must NOT throw)
 */
export async function sendPurchaseReceipt(
  payload: Payload,
  options: SendPurchaseReceiptOptions,
): Promise<boolean> {
  const {
    transactionId,
    userId,
    productId,
    providerTransactionId,
    amount,
    currency,
    userLocale = 'he',
    appliedCoupon,
    tierSlug,
    useGreenInvoiceNote = false,
  } = options

  // ── 1. Idempotency: skip if email already sent ─────────────────────────────
  const existing = await payload.findByID({
    collection: 'transactions',
    id: transactionId,
    depth: 0,
    overrideAccess: true,
  })

  if ((existing as { emailSentAt?: string | null }).emailSentAt) {
    payload.logger.info({ transactionId }, 'Purchase receipt email already sent — skipping')
    return true
  }

  // ── 2. Fetch user and (optionally) product data ───────────────────────────
  // Tier-subscription receipts pass `tierSlug` and an empty `productId`;
  // the product lookup is skipped and the line-item name is derived from
  // the localized tier label.
  let userEmail: string
  let productName: string

  try {
    const userResult = await payload.findByID({
      collection: 'users',
      id: userId,
      depth: 0,
      overrideAccess: true,
    })
    userEmail = (userResult as { email: string }).email

    if (tierSlug) {
      productName = userLocale === 'he' ? TIER_LABEL_HE[tierSlug] : TIER_LABEL_EN[tierSlug]
    } else if (productId) {
      const productResult = await payload.findByID({
        collection: 'products',
        id: productId,
        depth: 0,
        overrideAccess: true,
      })
      productName = (productResult as { name: string }).name
    } else {
      throw new Error('Purchase receipt requires either productId or tierSlug')
    }
  } catch (err) {
    payload.logger.error(
      { error: err, transactionId, userId, productId, tierSlug },
      'Purchase receipt email: failed to fetch user/product data',
    )
    return false
  }

  // ── 3. Build template data ─────────────────────────────────────────────────
  const paymentDate = new Date().toLocaleDateString(userLocale === 'he' ? 'he-IL' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const templateData: PurchaseReceiptData = {
    productName,
    amount,
    currency,
    transactionId: providerTransactionId,
    paymentDate,
    purchaseLink: PURCHASES_URL,
    useGreenInvoiceNote,
    ...(appliedCoupon
      ? {
          couponCode: appliedCoupon.code,
          couponDiscount: formatCouponDiscount(
            appliedCoupon.discountType,
            appliedCoupon.discountValue,
          ),
          originalAmount: appliedCoupon.originalAmount,
        }
      : {}),
  }

  const html = renderEmailTemplate(userLocale, templateData)

  // ── 4. Send email (no-op fallback if adapter not configured) ──────────────
  // payload.email is only populated when an email adapter (e.g. Resend, SendGrid)
  // is configured in payload.config.ts. In dev/test environments without an
  // adapter, we log a warning and return false — this must NOT throw so the
  // webhook can still return 200.
  if (!payload.email) {
    payload.logger.warn(
      { transactionId, userEmail, productName },
      'Purchase receipt email: no email adapter configured — skipping send (no-op fallback). Configure an email adapter in payload.config.ts to enable sending.',
    )
    return false
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.email as any).send({
      to: userEmail,
      subject:
        userLocale === 'he'
          ? `אישור רכישה — ${productName}`
          : `Purchase Confirmed — ${productName}`,
      html,
    })

    // Record successful send on the transaction
    await payload.update({
      collection: 'transactions',
      id: transactionId,
      data: { emailSentAt: new Date().toISOString() },
      overrideAccess: true,
    })

    payload.logger.info(
      { transactionId, userEmail, productName },
      'Purchase receipt email sent successfully',
    )
    return true
  } catch (err) {
    // Log the error with full context but do NOT throw — email failure must not
    // fail the webhook (200 still returned, payment + entitlements already granted).
    payload.logger.error(
      { error: err, transactionId, userEmail, productName },
      'Purchase receipt email send failed — email error logged, webhook will not fail',
    )
    return false
  }
}
