/**
 * PATCH /api/subscriptions/[id]/cancel
 *
 * User-initiated cancellation. Soft-cancel semantics:
 *   - status flips to 'cancelled' immediately
 *   - cancelAtPeriodEnd = true
 *   - cancelledAt = now
 *   - User.currentTier stays set — access continues until currentPeriodEnd
 *   - The Tranzilla renewal cron picks up (cancelAtPeriodEnd=true,
 *     currentPeriodEnd < now) rows and expires + downgrades them
 *
 * This mirrors PayPal's cancel-at-period-end semantics so the two paths
 * behave identically from the user's point of view: cancelling never
 * truncates a billing cycle you already paid for.
 *
 * Tranzila STO wrinkle: once a sub has `stoId` set, Tranzila's My-Billing
 * engine owns the recurring charge cadence — our cron excludes STO-managed
 * rows. If we only flip the local status to 'cancelled', Tranzila will
 * STILL charge the user on the next scheduled date (confirmed on the live
 * dashboard: STO rows stay 'פעיל' until explicitly inactivated). So for
 * STO-managed subs we must call Tranzila's /v2/sto/update {sto_status:
 * inactive} BEFORE flipping local state. If Tranzila's call fails we
 * return 502 and leave the DB untouched — safer for the user to see "try
 * again" than for us to lie about a billing stop that didn't happen.
 *
 * Only the owning user may cancel their own sub via this route; admins
 * cancel via the Payload admin panel directly (admin flow doesn't go
 * through this endpoint — a separate collection hook or manual Tranzila
 * dashboard step is required there; tracked as follow-up).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import { logger } from '@/infra/utils/logger'
import { getPaymentEnv } from '@/lib/payment/env'
import { cancelStandingOrder } from '@/lib/payment/tranzila-v2-client'

interface SubscriptionDoc {
  id: string
  user: string | { id: string } | null
  status: string
  provider?: string | null
  stoId?: string | null
  cancelAtPeriodEnd?: boolean | null
}

/**
 * The webhook's STO-handoff CAS claim writes a sentinel into `stoId` before
 * calling Tranzila's createstov2. If a cancel lands in that window, we
 * don't know yet whether the STO was created, so attempting to cancel it
 * would either 404 (never created) or race the handoff. Shape:
 *   `pending-handoff:<objectid-hex>`
 */
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

    // Idempotency comes first — a double-click or client retry on an
    // already-cancelled sub should return 200, not 409 from the status
    // allowlist. The spelling matches the earlier contract.
    if (sub.status === 'cancelled' && sub.cancelAtPeriodEnd === true) {
      return applyCorsHeaders(
        NextResponse.json(
          { success: true, subscriptionId: id, alreadyCancelled: true },
          { status: 200 },
        ),
        request,
      )
    }

    // `pending` is intentionally excluded. A pending sub has no charge yet;
    // if the user then approves the Tranzilla iframe payment, the webhook
    // (processing the approved first charge) would find a cancelled sub
    // and refuse to promote the user — producing a billed-but-free state.
    // Users who abandon checkout have no cleanup to do; the pending row
    // stays until admins manually expire it.
    if (!['active', 'past_due'].includes(sub.status)) {
      return applyCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: `Cannot cancel a subscription in state "${sub.status}"`,
          },
          { status: 409 },
        ),
        request,
      )
    }

    // Tranzila STO branch: if the sub has a real stoId, Tranzila owns the
    // recurring charges and we MUST tell them to stop before marking our
    // DB as cancelled. See file header for the full rationale.
    if (sub.provider === 'tranzilla' && sub.stoId) {
      if (isHandoffSentinelStoId(sub.stoId)) {
        // Mid-handoff: the webhook claimed the row but we don't yet know
        // whether createstov2 succeeded. Returning 409 asks the client to
        // retry in a moment — once handoff resolves, stoId is either a
        // real id (then this branch runs the cancel) or null (then we
        // fall through to pure soft-cancel because the cron owns renewals).
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

      const { tranzillaTerminalToken, tranzillaTerminal } = getPaymentEnv()
      const terminal = tranzillaTerminalToken || tranzillaTerminal
      try {
        const result = await cancelStandingOrder({
          terminalName: terminal,
          stoId: sub.stoId,
        })
        // Match the webhook rollback predicate: errorCode 0 or null means
        // Tranzila accepted the inactivation. Any other code is a real
        // failure — leave the DB untouched so the user can retry rather
        // than risk a "cancelled on our side, still billing on theirs"
        // split-brain.
        if (result.errorCode !== 0 && result.errorCode !== null) {
          // rawText contains Tranzila's `mismatch_info` on 20004 schema
          // errors — essential for diagnosing future field-shape bugs
          // (sto_id-string-vs-int was invisible without it, 2026-10-19).
          logger.error(
            {
              subscriptionId: id,
              stoId: sub.stoId,
              errorCode: result.errorCode,
              message: result.message,
              rawText: result.rawText,
              httpStatus: result.httpStatus,
            },
            '[subscriptions/cancel] Tranzila cancelStandingOrder returned non-zero error_code',
          )
          return applyCorsHeaders(
            NextResponse.json(
              {
                success: false,
                error: 'Failed to cancel Tranzila standing order, please try again',
              },
              { status: 502 },
            ),
            request,
          )
        }
      } catch (tranzillaErr) {
        logger.error(
          {
            subscriptionId: id,
            stoId: sub.stoId,
            err: tranzillaErr instanceof Error ? tranzillaErr.message : String(tranzillaErr),
          },
          '[subscriptions/cancel] Tranzila cancelStandingOrder threw',
        )
        return applyCorsHeaders(
          NextResponse.json(
            {
              success: false,
              error: 'Failed to cancel Tranzila standing order, please try again',
            },
            { status: 502 },
          ),
          request,
        )
      }
    }

    // skipStoCancel tells the Subscriptions.beforeChange hook not to call
    // cancelStandingOrder — we already did that above and don't want a
    // second call. The hook defaults to running Tranzila's cancel on any
    // active→cancelled transition that lacks this flag (i.e. admin UI).
    const updated = await payload.update({
      collection: 'subscriptions',
      id,
      data: {
        status: 'cancelled',
        cancelAtPeriodEnd: true,
        cancelledAt: new Date().toISOString(),
      },
      overrideAccess: true,
      context: { skipStoCancel: true },
    })

    return applyCorsHeaders(
      NextResponse.json(
        {
          success: true,
          subscriptionId: id,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: (updated as { currentPeriodEnd?: string }).currentPeriodEnd ?? null,
        },
        { status: 200 },
      ),
      request,
    )
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'PATCH /api/subscriptions/[id]/cancel failed',
    )
    return applyCorsHeaders(
      NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 }),
      request,
    )
  }
}
