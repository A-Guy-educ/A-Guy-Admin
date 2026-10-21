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

    // Each 400 below is logged with a stable `gate` discriminator. The
    // response body already carries a human-readable `error`, but Web
    // surfaces a generic message to the buyer, so when a legitimate user
    // hits a 400 we need the server log to tell us which gate fired
    // (2026-10-19 incident: boss hit "tenant missing" and the site showed
    // a generic error with no clue which validation tripped).
    if (!isPaidTierSlug(tierSlug)) {
      logger.warn(
        { userId: user.id, gate: 'tierSlug_invalid', tierSlug: String(tierSlug) },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'tierSlug must be one of basic|advanced|premium' },
          { status: 400 },
        ),
        request,
      )
    }
    if (!isTranzillaOfferSlug(offerSlug)) {
      logger.warn(
        { userId: user.id, gate: 'offerSlug_invalid', offerSlug: String(offerSlug) },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'offerSlug must be one of default|intro3mo|test' },
          { status: 400 },
        ),
        request,
      )
    }
    if (!isOfferAllowedForEnvironment(offerSlug)) {
      logger.warn(
        { userId: user.id, gate: 'offer_env_gated', offerSlug },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
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
      logger.warn(
        {
          userId: user.id,
          gate: 'redirect_urls_missing',
          successUrlType: typeof successUrl,
          cancelUrlType: typeof cancelUrl,
        },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
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
      logger.warn(
        { userId: user.id, gate: 'redirect_url_disallowed', successUrl, cancelUrl },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
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
    //
    // Stale-pending auto-expiry: a user who clicks Pay (we create a pending
    // sub + tx) then abandons the Tranzila iframe (closed window, decline,
    // 3DS timeout) would otherwise be soft-locked out of retrying on the
    // same account. We don't learn about those abandonments — Tranzila sends
    // no webhook when the hosted charge doesn't complete. If the pending sub
    // is older than STALE_PENDING_THRESHOLD_MS we treat it as abandoned,
    // expire it + its pending tx, and let the retry create a fresh sub.
    // Threshold is comfortably longer than Tranzila's hosted-page session
    // lifetime (handshake `thtk` expires in minutes) so we don't nuke an
    // in-flight payment.
    const STALE_PENDING_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes
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
      const existingSub = existing.docs[0] as Subscription & { createdAt?: string }
      const isStalePending =
        existingSub.status === 'pending' &&
        existingSub.createdAt &&
        Date.now() - new Date(existingSub.createdAt).getTime() > STALE_PENDING_THRESHOLD_MS

      if (isStalePending) {
        // Mark the stale pending sub + its initial tx expired, then fall
        // through to create a fresh pair. If a late webhook for the old sub
        // somehow arrives after this point, extendTierSubscription's
        // status='pending' CAS will no-op and the webhook returns 200.
        logger.info(
          {
            userId: user.id,
            staleSubId: existingSub.id,
            staleCreatedAt: existingSub.createdAt,
            ageMs: Date.now() - new Date(existingSub.createdAt!).getTime(),
          },
          'POST /api/subscriptions/bootstrap/tranzilla: auto-expiring stale pending sub',
        )
        await payload.update({
          collection: 'subscriptions',
          id: existingSub.id,
          data: { status: 'expired' },
          overrideAccess: true,
        })
        if (existingSub.initialTransaction) {
          const txId =
            typeof existingSub.initialTransaction === 'string'
              ? existingSub.initialTransaction
              : existingSub.initialTransaction.id
          await payload
            .update({
              collection: 'transactions',
              id: txId,
              data: { status: 'failed' },
              overrideAccess: true,
            })
            .catch((err: unknown) => {
              logger.warn(
                { txId, err: err instanceof Error ? err.message : String(err) },
                'POST /api/subscriptions/bootstrap/tranzilla: failed to mark stale tx failed (non-fatal)',
              )
            })
        }
        // Fall through — a fresh pending sub + tx will be created below.
      } else {
        return applyCorsHeaders(
          NextResponse.json(
            {
              success: false,
              error: 'User already has an active or pending subscription',
              subscriptionId: existingSub.id,
            },
            { status: 409 },
          ),
          request,
        )
      }
    }

    const offer = resolveTranzillaOffer(tierSlug, offerSlug)
    if (!offer) {
      // Catalog has no entry for this (tier, offer) combination — e.g.
      // `test` is only configured for `basic`, so advanced/premium with
      // offer=test fall here.
      logger.warn(
        { userId: user.id, gate: 'offer_tier_catalog_gap', tierSlug, offerSlug },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
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
      logger.warn(
        { userId: user.id, gate: 'user_missing_tenant', userEmail: user.email },
        'POST /api/subscriptions/bootstrap/tranzilla: rejected 400',
      )
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
    // Hosted-iframe charge runs on the REGULAR terminal (fxpaguy), not the
    // tokenization terminal (fxpaguytok). Per Tranzila support: the
    // tokenization terminal is API-only and has no hosted payment page
    // (every /{fxpaguytok}/*.php returns 404). The regular terminal issues
    // a TranzilaTK on the notify_url POST that's valid account-wide, and
    // the webhook then passes that token to createstov2 with
    // terminal_name=fxpaguytok where My-Billing takes over for recurring
    // charges. Tokens are account-scoped, not terminal-scoped.
    const checkout = await createTranzillaCheckout({
      sum: priceIls,
      currency: 'ILS',
      description: `AGuy ${tierSlug} — ${offerSlug}`,
      successUrl,
      cancelUrl,
      notifyUrl,
      lang: 'il',
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
