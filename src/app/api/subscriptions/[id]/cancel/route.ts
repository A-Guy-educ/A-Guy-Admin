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
 * Only the owning user may cancel their own sub via this route; admins
 * cancel via the Payload admin panel directly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import { logger } from '@/infra/utils/logger'

interface SubscriptionDoc {
  id: string
  user: string | { id: string } | null
  status: string
  cancelAtPeriodEnd?: boolean | null
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

    if (!['active', 'past_due', 'pending'].includes(sub.status)) {
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

    const updated = await payload.update({
      collection: 'subscriptions',
      id,
      data: {
        status: 'cancelled',
        cancelAtPeriodEnd: true,
        cancelledAt: new Date().toISOString(),
      },
      overrideAccess: true,
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
