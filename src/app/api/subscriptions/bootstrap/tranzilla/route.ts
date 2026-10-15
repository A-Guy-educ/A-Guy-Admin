/**
 * POST /api/subscriptions/bootstrap/tranzilla
 *
 * Called cross-origin from Web after the buyer picks a tier + offer. Admin
 * owns the subscription state end-to-end:
 *   1. Resolves pricing from the admin catalog (tier-tranzilla-pricing.ts).
 *   2. Creates a pending Transactions row (first charge) + pending
 *      Subscriptions row with the pricing snapshot.
 *   3. Builds a Tranzilla hosted-iframe checkout URL that captures a
 *      reusable TranzilaTK token on first charge, correlating back via:
 *         u71 = userId
 *         u72 = transactionId (one-time webhook path uses this)
 *         u73 = subscriptionId (NEW — webhook subscription-bootstrap branch)
 *   4. Returns the URL for Web to redirect to.
 *
 * On successful first charge, Tranzilla fires notify_url → the webhook sees
 * u73, promotes the sub to active via extendTierSubscription, flips the Tx
 * to succeeded, and stores TranzilaTK for merchant-initiated renewals.
 *
 * On decline the webhook flips the Tx to failed and marks the pending sub
 * as expired (bootstrap failed; buyer never got in).
 */

import { ObjectId } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import {
  computeNextChargePriceIls,
  isPaidTierSlug,
  isTranzillaOfferSlug,
  resolveTranzillaOffer,
} from '@/lib/payment/tier-tranzilla-pricing'
import { createTranzillaCheckout } from '@/lib/payment/tranzilla'
import { logger } from '@/infra/utils/logger'

interface BootstrapBody {
  tierSlug?: unknown
  offerSlug?: unknown
  successUrl?: unknown
  cancelUrl?: unknown
}

function serverBaseUrl(request: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_SERVER_URL
  if (envUrl) return envUrl.replace(/\/+$/, '')
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request)
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    if (!user || user.collection !== 'users') {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 }),
        request,
      )
    }

    let body: BootstrapBody
    try {
      body = (await request.json()) as BootstrapBody
    } catch {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }),
        request,
      )
    }

    const tierSlug = body.tierSlug
    const offerSlug = body.offerSlug
    const successUrl = body.successUrl
    const cancelUrl = body.cancelUrl

    if (!isPaidTierSlug(tierSlug)) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'tierSlug must be one of basic|advanced|premium' },
          { status: 400 },
        ),
        request,
      )
    }
    if (!isTranzillaOfferSlug(offerSlug)) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'offerSlug must be one of default|intro3mo' },
          { status: 400 },
        ),
        request,
      )
    }
    if (typeof successUrl !== 'string' || typeof cancelUrl !== 'string') {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'successUrl and cancelUrl are required' },
          { status: 400 },
        ),
        request,
      )
    }

    // Reject if the user already has an active-ish sub — Web shouldn't offer
    // the checkout flow in that case, but belt-and-braces here protects
    // against two-tab double-subscribe.
    const existing = await payload.find({
      collection: 'subscriptions',
      where: {
        and: [{ user: { equals: user.id } }, { status: { in: ['pending', 'active', 'past_due'] } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: 'User already has an active or pending subscription',
            subscriptionId: (existing.docs[0] as { id: string }).id,
          },
          { status: 409 },
        ),
        request,
      )
    }

    const offer = resolveTranzillaOffer(tierSlug, offerSlug)
    const { priceIls, isIntroCharge } = computeNextChargePriceIls({
      introPriceIls: offer.introPriceIls,
      introChargesTotal: offer.introChargesTotal,
      introChargesUsed: 0,
      regularPriceIls: offer.regularPriceIls,
    })

    // Transactions + Subscriptions have `tenant` as a required field; refuse
    // to bootstrap for users without one rather than let Mongo reject the
    // insert at write time (which would surface as a 500 to the caller).
    const tenant = (user as { tenant?: string | { id: string } | null }).tenant
    const tenantId =
      typeof tenant === 'object' && tenant ? tenant.id : (tenant as string | null | undefined)
    if (!tenantId) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'User has no tenant assigned' },
          { status: 400 },
        ),
        request,
      )
    }

    // Pending Transaction. Placeholder providerTransactionId gets overwritten
    // with the real Tranzilla `index` by the first-charge webhook. Must be
    // unique collection-wide; an ObjectId-derived prefix guarantees that.
    const placeholderProviderTxId = `tz-pending-${new ObjectId().toHexString()}`

    const transaction = await payload.create({
      collection: 'transactions',
      data: {
        tenant: tenantId,
        user: user.id,
        tierSlug,
        provider: 'tranzilla',
        providerTransactionId: placeholderProviderTxId,
        status: 'pending',
        amount: priceIls * 100, // agorot
        currency: 'ILS',
        isIntroCharge,
        successUrl,
        cancelUrl,
      },
      draft: false,
      overrideAccess: true,
    })

    const subscription = await payload.create({
      collection: 'subscriptions',
      data: {
        tenant: tenantId,
        user: user.id,
        tierSlug,
        provider: 'tranzilla',
        offerSlug,
        introPriceIls: offer.introPriceIls,
        introChargesTotal: offer.introChargesTotal,
        introChargesUsed: 0,
        regularPriceIls: offer.regularPriceIls,
        status: 'pending',
        initialTransaction: transaction.id,
      },
      draft: false,
      overrideAccess: true,
    })

    // Wire the Tx back to the sub for symmetry.
    await payload.update({
      collection: 'transactions',
      id: transaction.id,
      data: { subscription: subscription.id },
      overrideAccess: true,
    })

    const base = serverBaseUrl(request)
    const notifyUrl = `${base}/api/webhooks/tranzilla`
    const checkout = createTranzillaCheckout({
      sum: priceIls,
      currency: 'ILS',
      description: `AGuy ${tierSlug} — ${offerSlug}`,
      successUrl,
      cancelUrl,
      notifyUrl,
      lang: 'il',
      useTokenTerminal: true,
      cField1: String(user.id),
      cField2: String(transaction.id),
      cField3: String(subscription.id),
    })

    return applyCorsHeaders(
      NextResponse.json(
        {
          success: true,
          checkoutUrl: checkout.checkoutUrl,
          subscriptionId: subscription.id,
          transactionId: transaction.id,
        },
        { status: 200 },
      ),
      request,
    )
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'POST /api/subscriptions/bootstrap/tranzilla failed',
    )
    return applyCorsHeaders(
      NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 }),
      request,
    )
  }
}
