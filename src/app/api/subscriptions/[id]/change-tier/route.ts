/**
 * PATCH /api/subscriptions/[id]/change-tier
 *
 * User-initiated mid-cycle tier change on a Tranzila STO-managed subscription.
 *
 * Semantics (Mission 2 of the Tranzila tracker, upgrade path only):
 *   - UPGRADE (new tier's regular price > current):
 *       1. Charge the full new-tier price now via chargeTranzillaToken (the
 *          stored card token). Option-b "full new period" per Web's RFC —
 *          user pays today for a fresh 30-day cycle at the new tier.
 *          Skipped when newPrice < MIN_CHARGE_ILS (test offers under
 *          Tranzila's processing minimum).
 *       2. Swap the STO's items via /v2/sto/update so NEXT cycle also bills
 *          at the new price.
 *       3. Update sub.tierSlug + sub.regularPriceIls + reset
 *          currentPeriodStart/End to today + 30d.
 *       4. Flip User.currentTier via applyTierPurchase.
 *     Charge fails → 502, no local state changes (clean retry).
 *   - DOWNGRADE and SAME-TIER: not supported in this PR; return 400.
 *     Downgrade needs a cycle-boundary tier flip + swap (follow-up).
 *
 * Design notes:
 *   - Charge-first ordering: if the charge fails we've changed nothing. The
 *     alternative (swap first) would strand us at "next cycle at new price
 *     but user still on old tier" if the charge fails after the swap.
 *   - Items-swap uses the same sto_id (keeps the card attached on Tranzila's
 *     side). The webhook's STO handoff NO LONGER nullifies tranzillaCardToken
 *     — it stays on the sub precisely so this endpoint can charge against it.
 *   - introChargesUsed carries over across a tier change — intro grant is
 *     per-user, not per-tier. User doesn't get a fresh intro by upgrading.
 */

import { ObjectId } from 'mongodb'
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import { logger } from '@/infra/utils/logger'
import { applyTierPurchase } from '@/lib/payment/apply-tier-purchase'
import { getPaymentEnv } from '@/lib/payment/env'
import { addCalendarMonths } from '@/lib/payment/grant-entitlements'
import { isPaidTierSlug, resolveTranzillaOffer } from '@/lib/payment/tier-tranzilla-pricing'
import { chargeTranzillaToken } from '@/lib/payment/tranzilla'
import { swapStandingOrderItems } from '@/lib/payment/tranzila-v2-client'
import type { TierSlug } from '@/lib/tiers/constants'

/**
 * Tranzila's card-processing minimum (approximate). Upgrade charges below
 * this threshold are skipped — user gets the tier bump "for free" because
 * Tranzila won't accept a sub-₪1 one-off charge. In practice this only
 * matters for the `test` offer prices (0.01/0.02/0.03) used by Web's
 * /subtest page; real tier prices (basic 59, advanced 119, premium 239)
 * are all well above this floor.
 */
const MIN_CHARGE_ILS = 1

interface SubscriptionDoc {
  id: string
  tenant?: string | { id: string } | null
  user: string | { id: string } | null
  status: string
  provider?: string | null
  tierSlug?: string | null
  offerSlug?: string | null
  stoId?: string | null
  regularPriceIls?: number | null
  tranzillaCardToken?: string | null
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

    // Upgrade path — order: charge FIRST, then swap, then flip. Charge-first
    // means a failed charge leaves zero state changed (clean retry). The
    // alternative (swap first) would strand us at "new price for next cycle
    // but user still on old tier" if charge fails.
    const { tranzillaTerminalToken, tranzillaTerminal } = getPaymentEnv()
    const terminal = tranzillaTerminalToken || tranzillaTerminal

    const tenantId =
      typeof sub.tenant === 'object' && sub.tenant
        ? sub.tenant.id
        : (sub.tenant as string | null | undefined)

    // 1. Charge the full new-tier amount (option-b "full new period" semantics
    //    — user gets a fresh 30-day cycle at the new price). Skipped for
    //    amounts below the Tranzila minimum so test flows (0.01-0.03 ILS)
    //    still exercise the upgrade mechanics.
    let upgradeChargeIndex: string | null = null
    if (newPrice >= MIN_CHARGE_ILS) {
      if (!sub.tranzillaCardToken) {
        logger.error(
          { subscriptionId: id },
          '[subscriptions/change-tier] sub has no tranzillaCardToken — cannot charge for upgrade',
        )
        return applyCorsHeaders(
          NextResponse.json(
            {
              success: false,
              error: 'Subscription has no stored card. Cancel and resubscribe to upgrade.',
            },
            { status: 500 },
          ),
          request,
        )
      }

      const charge = await chargeTranzillaToken({
        token: sub.tranzillaCardToken,
        sum: newPrice,
        currency: 'ILS',
        description: `AGuy ${newTierSlug} — upgrade`,
      }).catch((err: unknown) => {
        logger.error(
          { subscriptionId: id, err: err instanceof Error ? err.message : String(err) },
          '[subscriptions/change-tier] chargeTranzillaToken threw',
        )
        return null
      })

      if (!charge) {
        return applyCorsHeaders(
          NextResponse.json(
            {
              success: false,
              error: 'Failed to reach Tranzila for upgrade charge, please try again',
            },
            { status: 502 },
          ),
          request,
        )
      }
      if (charge.providerError) {
        logger.error(
          { subscriptionId: id, reason: charge.providerErrorReason },
          '[subscriptions/change-tier] Tranzila provider error on upgrade charge',
        )
        return applyCorsHeaders(
          NextResponse.json(
            { success: false, error: 'Tranzila provider error, please try again' },
            { status: 502 },
          ),
          request,
        )
      }
      if (!charge.approved) {
        logger.warn(
          { subscriptionId: id, responseCode: charge.responseCode },
          '[subscriptions/change-tier] upgrade charge declined',
        )
        return applyCorsHeaders(
          NextResponse.json(
            {
              success: false,
              error: 'Card declined on upgrade charge, please update your card or try again',
            },
            { status: 502 },
          ),
          request,
        )
      }
      upgradeChargeIndex = charge.index

      // Record the upgrade charge as a Transaction row. Best-effort: if this
      // throws we log fatal + continue — the money moved, we don't want to
      // undo the upgrade.
      if (tenantId) {
        try {
          await payload.create({
            collection: 'transactions',
            data: {
              tenant: tenantId,
              user: user.id,
              tierSlug: newTierSlug,
              provider: 'tranzilla',
              providerTransactionId: charge.index ?? `tz-upgrade-${new ObjectId().toHexString()}`,
              status: 'succeeded',
              amount: Math.round(newPrice * 100),
              currency: 'ILS',
              subscription: id,
              entitlementsGrantedAt: new Date().toISOString(),
              metadata: {
                tranzilla: {
                  confirmationCode: charge.confirmationCode,
                  responseCode: charge.responseCode,
                  upgradeFromTier: sub.tierSlug,
                  upgradeToTier: newTierSlug,
                },
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            draft: false,
            overrideAccess: true,
          })
        } catch (txErr) {
          logger.fatal(
            {
              subscriptionId: id,
              upgradeChargeIndex: charge.index,
              err: txErr instanceof Error ? txErr.message : String(txErr),
            },
            '[subscriptions/change-tier] CRITICAL — upgrade charged but Transactions row create FAILED. Reconcile manually.',
          )
        }
      }
    } else {
      logger.info(
        { subscriptionId: id, newPrice, minChargeIls: MIN_CHARGE_ILS },
        '[subscriptions/change-tier] upgrade charge skipped — amount below Tranzila minimum',
      )
    }

    // 2. Swap STO items so future cycles bill at the new price.
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

    // 3. Tranzila accepted the price change. Update local sub + flip tier.
    //    The order (sub first, then user tier) matches extendTierSubscription's
    //    "write the authoritative state first, derived state second" invariant.
    //    Period dates reset to now + 30d — fresh cycle at the new tier, which
    //    the upgrade charge paid for (option-b full new period semantics).
    const now = new Date()
    const newPeriodEnd = addCalendarMonths(now, 1)
    await payload.update({
      collection: 'subscriptions',
      id,
      data: {
        tierSlug: newTierSlug,
        regularPriceIls: newPrice,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: newPeriodEnd.toISOString(),
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
        upgradeChargeIndex,
        newPeriodEnd: newPeriodEnd.toISOString(),
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
          upgradeChargeIndex,
          currentPeriodEnd: newPeriodEnd.toISOString(),
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
