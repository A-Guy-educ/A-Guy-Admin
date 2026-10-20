/**
 * PATCH /api/subscriptions/[id]/change-tier
 *
 * User-initiated mid-cycle tier change on a Tranzila STO-managed subscription.
 *
 * Semantics (upgrade path only in this PR):
 *   - UPGRADE (new tier's regular price > current):
 *       1. Swap the STO's items via /v2/sto/update so NEXT cycle bills at
 *          the new tier price.
 *       2. Update sub.tierSlug + sub.regularPriceIls.
 *       3. Flip User.currentTier via applyTierPurchase (immediate access).
 *     NO mid-cycle delta charge. User gets a "free upgrade window" through
 *     the end of the current paid cycle, then pays the new tier next cycle.
 *     This is a deliberate tradeoff of the no-stored-token policy — we can't
 *     charge the card out-of-band because we don't retain the TranzilaTK.
 *   - DOWNGRADE and SAME-TIER: not supported in this PR; return 400.
 *     Downgrade needs cycle-boundary tier flip + swap (follow-up).
 *
 * Design notes:
 *   - Items-swap on the existing STO (same sto_id, same card on Tranzila's
 *     side). No card token needed on our side — the webhook nullifies
 *     tranzillaCardToken after handoff per the no-stored-tokens policy.
 *   - introChargesUsed carries over across a tier change — intro grant is
 *     per-user, not per-tier. User doesn't get a fresh intro by upgrading.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import { logger } from '@/infra/utils/logger'
import { applyTierPurchase } from '@/lib/payment/apply-tier-purchase'
import { getPaymentEnv } from '@/lib/payment/env'
import { isPaidTierSlug, resolveTranzillaOffer } from '@/lib/payment/tier-tranzilla-pricing'
import { swapStandingOrderItems } from '@/lib/payment/tranzila-v2-client'
import type { TierSlug } from '@/lib/tiers/constants'

interface SubscriptionDoc {
  id: string
  user: string | { id: string } | null
  status: string
  provider?: string | null
  tierSlug?: string | null
  offerSlug?: string | null
  stoId?: string | null
  regularPriceIls?: number | null
}

interface ChangeTierBody {
  tierSlug?: unknown
}

function isHandoffSentinelStoId(stoId: string): boolean {
  return stoId.startsWith('pending-handoff:')
}

function resolveOwnerId(user: SubscriptionDoc['user']): string | null {
  if (!user) return null
  return typeof user === 'string' ? user : user.id
}

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'subscription id required' }, { status: 400 }),
        request,
      )
    }

    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    if (!user || user.collection !== 'users') {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 }),
        request,
      )
    }

    let body: ChangeTierBody
    try {
      body = (await request.json()) as ChangeTierBody
    } catch {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }),
        request,
      )
    }

    const newTierSlug = body.tierSlug
    if (!isPaidTierSlug(newTierSlug)) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'tierSlug must be one of basic|advanced|premium' },
          { status: 400 },
        ),
        request,
      )
    }

    let sub: SubscriptionDoc | null
    try {
      sub = (await payload.findByID({
        collection: 'subscriptions',
        id,
        depth: 0,
        overrideAccess: true,
      })) as SubscriptionDoc
    } catch {
      sub = null
    }
    if (!sub) {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'Subscription not found' }, { status: 404 }),
        request,
      )
    }

    const ownerId = resolveOwnerId(sub.user)
    if (ownerId !== user.id) {
      return applyCorsHeaders(
        NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }),
        request,
      )
    }

    if (sub.status !== 'active' && sub.status !== 'past_due') {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: `Cannot change tier on a subscription in state "${sub.status}"`,
          },
          { status: 409 },
        ),
        request,
      )
    }

    if (sub.provider !== 'tranzilla') {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: 'Tier change is only supported for Tranzila subscriptions' },
          { status: 400 },
        ),
        request,
      )
    }

    // No stoId → cron-driven sub (pre-M1 or handoff failure). Items-swap
    // relies on the My-Billing STO engine; a cron-charged sub has nothing
    // to update. Reject so the user doesn't get a false success.
    if (!sub.stoId) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: 'Tier change is not supported on this subscription (no standing-order id)',
          },
          { status: 400 },
        ),
        request,
      )
    }

    if (isHandoffSentinelStoId(sub.stoId)) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: 'Subscription handoff is still in progress, try again in a moment',
          },
          { status: 409 },
        ),
        request,
      )
    }

    if (sub.tierSlug === newTierSlug) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: false, error: `Subscription is already on tier "${newTierSlug}"` },
          { status: 400 },
        ),
        request,
      )
    }

    const currentPrice = sub.regularPriceIls ?? 0
    const offerSlug = sub.offerSlug ?? 'default'

    // Resolve the new tier's regular price via the pricing catalog. Keep the
    // same offerSlug — carrying intro state across a tier change is handled
    // by the surrounding fields (introChargesUsed stays as-is).
    const newOffer = resolveTranzillaOffer(
      newTierSlug,
      offerSlug as 'default' | 'intro3mo' | 'test',
    )
    if (!newOffer) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: `Tier "${newTierSlug}" is not available on offer "${offerSlug}"`,
          },
          { status: 400 },
        ),
        request,
      )
    }
    const newPrice = newOffer.regularPriceIls

    // Direction gate — this PR ships upgrade only. Downgrade needs a
    // cycle-boundary tier flip (keep paid-for tier until currentPeriodEnd,
    // then swap). Follow-up PR.
    if (newPrice < currentPrice) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error:
              'Mid-cycle downgrade is not yet supported. Cancel and resubscribe to the lower tier.',
          },
          { status: 400 },
        ),
        request,
      )
    }
    if (newPrice === currentPrice) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: `Tier "${newTierSlug}" has the same price as the current tier (no change)`,
          },
          { status: 400 },
        ),
        request,
      )
    }

    // Upgrade path — swap items on the existing STO, flip tier locally.
    // No immediate charge: policy is no-stored-tokens, so we can't charge
    // mid-cycle. User gets premium access now, pays the new tier at the
    // next scheduled STO charge (free-upgrade-window tradeoff).
    const { tranzillaTerminalToken, tranzillaTerminal } = getPaymentEnv()
    const terminal = tranzillaTerminalToken || tranzillaTerminal

    const result = await swapStandingOrderItems({
      terminalName: terminal,
      stoId: sub.stoId,
      itemName: `AGuy Subscription — ${newTierSlug}`,
      unitPriceIls: newPrice,
    }).catch((err: unknown) => {
      logger.error(
        {
          subscriptionId: id,
          stoId: sub!.stoId,
          err: err instanceof Error ? err.message : String(err),
        },
        '[subscriptions/change-tier] swapStandingOrderItems threw',
      )
      return null
    })

    if (!result) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: 'Failed to reach Tranzila to update the standing order, please try again',
          },
          { status: 502 },
        ),
        request,
      )
    }

    if (result.errorCode !== 0 && result.errorCode !== null) {
      logger.error(
        {
          subscriptionId: id,
          stoId: sub.stoId,
          errorCode: result.errorCode,
          message: result.message,
          rawText: result.rawText,
          httpStatus: result.httpStatus,
        },
        '[subscriptions/change-tier] Tranzila /v2/sto/update returned non-zero error_code',
      )
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: 'Tranzila refused the tier change, please try again',
          },
          { status: 502 },
        ),
        request,
      )
    }

    // Tranzila accepted the price change. Update local sub + flip tier.
    // Period dates NOT reset — user keeps their paid-for cycle at the old
    // tier end-date; the new tier price only takes effect at next STO run.
    await payload.update({
      collection: 'subscriptions',
      id,
      data: {
        tierSlug: newTierSlug,
        regularPriceIls: newPrice,
      },
      overrideAccess: true,
    })

    await applyTierPurchase(payload, user.id, newTierSlug as TierSlug)

    logger.info(
      {
        subscriptionId: id,
        stoId: sub.stoId,
        fromTier: sub.tierSlug,
        toTier: newTierSlug,
        newPriceIls: newPrice,
      },
      '[subscriptions/change-tier] upgrade applied (free window; next cycle at new price)',
    )

    return applyCorsHeaders(
      NextResponse.json(
        {
          success: true,
          subscriptionId: id,
          tierSlug: newTierSlug,
          regularPriceIls: newPrice,
          effectiveAt: 'immediately',
        },
        { status: 200 },
      ),
      request,
    )
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'PATCH /api/subscriptions/[id]/change-tier failed',
    )
    return applyCorsHeaders(
      NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 }),
      request,
    )
  }
}
