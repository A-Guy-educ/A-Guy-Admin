/**
 * PATCH /api/subscriptions/[id]/change-tier
 *
 * User-initiated mid-cycle tier change on a Tranzila STO-managed subscription.
 *
 * Semantics (Mission 2 of the Tranzila tracker, upgrade path only in this PR):
 *   - UPGRADE (new tier's regular price > current): tier flips immediately in
 *     User.currentTier; the STO's items array is swapped in place via
 *     /v2/sto/update so the next recurring charge runs at the new price.
 *     NO mid-cycle delta charge — user gets a "free upgrade window" through
 *     the end of the current paid cycle. introChargesUsed carries over.
 *   - DOWNGRADE and SAME-TIER: not supported in this PR; return 400 with a
 *     clear message. Downgrade requires a cycle-boundary tier flip + swap
 *     which depends on cron work (follow-up PR).
 *
 * Design notes:
 *   - We swap items on the EXISTING STO rather than cancel + create. The
 *     create path requires a card token (TranzilaTK) which we nullify after
 *     handoff for PCI reasons — there's no safe way to recover it without a
 *     fresh iframe entry. Items-swap keeps the same sto_id and card.
 *   - The item name sent to Tranzila updates the dashboard label too, so the
 *     merchant can see the tier change reflected in the My-Billing UI.
 *   - stoItemId (the master - 1 arithmetic the mission tracker discusses as a
 *     cancel workaround) is NOT touched here. The master update IS what Tranzila
 *     bills from (the item line's unit_price), so this works regardless of
 *     whether cancel-master-only is enough.
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
    // The order (sub first, then user tier) matches extendTierSubscription's
    // "write the authoritative state first, derived state second" invariant.
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
      '[subscriptions/change-tier] upgrade applied',
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
