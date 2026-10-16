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
import type { Subscription } from '@/payload-types'
import { applyCorsHeaders, createPreflightResponse, isAllowedOrigin } from '@/lib/http/cors'
import {
  computeNextChargePriceIls,
  isOfferAllowedForEnvironment,
  isPaidTierSlug,
  isTranzillaOfferSlug,
  resolveTranzillaOffer,
} from '@/lib/payment/tier-tranzilla-pricing'
import { createTranzillaCheckout } from '@/lib/payment/tranzilla'
import { logger } from '@/infra/utils/logger'

function isSafeRedirectUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    return isAllowedOrigin(parsed.origin)
  } catch {
    return false
  }
}

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
          { success: false, error: 'offerSlug must be one of default|intro3mo|test' },
          { status: 400 },
        ),
        request,
      )
    }
    if (!isOfferAllowedForEnvironment(offerSlug)) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: `offerSlug "${offerSlug}" is not available in this environment`,
          },
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
    // Validate redirect targets against the CORS allowlist so an
    // authenticated attacker can't mint a checkout URL whose post-payment
    // redirect lands on a phishing page they control. Tranzilla will
    // happily redirect buyers to any URL we embed in the iframe params.
    if (!isSafeRedirectUrl(successUrl) || !isSafeRedirectUrl(cancelUrl)) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'successUrl and cancelUrl must target an allowlisted origin' },
          { status: 400 },
        ),
        request,
      )
    }

    // Reject if the user already has an active-ish sub. The find is a fast
    // path for the common case; the partial unique index on subscriptions.user
    // (status ∈ {pending,active,past_due}) is the real race-safe guard —
    // see the E11000 catch below on the Subscriptions.create call.
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
    if (!offer) {
      // Catalog has no entry for this (tier, offer) combination — e.g.
      // `test` is only configured for `basic`, so advanced/premium with
      // offer=test fall here.
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: `offerSlug "${offerSlug}" is not available for tier "${tierSlug}"`,
          },
          { status: 400 },
        ),
        request,
      )
    }
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

    let subscription: Subscription
    try {
      subscription = await payload.create({
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
    } catch (createErr) {
      // Partial unique index on subscriptions.user (active-ish statuses)
      // trips when a concurrent request from the same user has already
      // inserted a pending/active sub between our pre-check find and
      // this create. Roll back the Transaction we just created and
      // return 409 — the client sees the same shape as the application
      // guard above.
      if (isDuplicateKeyError(createErr)) {
        try {
          await payload.delete({
            collection: 'transactions',
            id: transaction.id,
            overrideAccess: true,
          })
        } catch (rollbackErr) {
          logger.error(
            {
              err: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
              transactionId: transaction.id,
            },
            'POST /api/subscriptions/bootstrap/tranzilla: failed to roll back pending transaction after concurrent-insert conflict',
          )
        }
        return applyCorsHeaders(
          NextResponse.json(
            {
              success: false,
              error: 'User already has an active or pending subscription',
            },
            { status: 409 },
          ),
          request,
        )
      }
      throw createErr
    }

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
