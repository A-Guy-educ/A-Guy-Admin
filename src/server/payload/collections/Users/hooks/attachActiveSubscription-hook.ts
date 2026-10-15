/**
 * afterRead hook — attaches a lightweight `activeSubscription` summary onto
 * the Users doc when the request is made by the user reading their own
 * record (i.e. GET /api/users/me).
 *
 * This replaces denormalizing provider-sub state onto the Users doc. The
 * Subscriptions collection remains the single source of truth; web just
 * sees a joined view via the standard /api/users/me endpoint.
 *
 * Scope guard: only runs when `req.user.id === doc.id`. Admin-side reads
 * of other users do NOT trigger the lookup — those are hot paths in the
 * admin UI and we don't want to add a sub-collection query per users row.
 *
 * Shape (not persisted; Payload types won't surface it):
 *   {
 *     status: 'active' | 'past_due' | 'cancelled' | 'pending',
 *     tierSlug, offerSlug, provider,
 *     currentPeriodEnd, cancelAtPeriodEnd,
 *     paypalSubscriptionId   // null for Tranzilla
 *   }
 *
 * If no active-ish sub exists, the field is set to null — explicit null is
 * easier to read on the web side than a missing key.
 */

import type { CollectionAfterReadHook } from 'payload'

type MinimalUser = { id?: string } | null | undefined

interface SubscriptionDoc {
  id: string
  status: string
  tierSlug?: string | null
  offerSlug?: string | null
  provider?: string | null
  currentPeriodEnd?: string | Date | null
  cancelAtPeriodEnd?: boolean | null
  paypalSubscriptionId?: string | null
}

export interface ActiveSubscriptionSummary {
  id: string
  status: string
  tierSlug: string | null
  offerSlug: string | null
  provider: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  paypalSubscriptionId: string | null
}

export const attachActiveSubscription: CollectionAfterReadHook = async ({ doc, req }) => {
  // `req.user` can be a User OR an MCP API key; `collection` discriminates.
  const user = req.user as MinimalUser & { collection?: string }
  const docId = (doc as { id?: string }).id

  // Only enrich self-reads. Admin-browsing-other-users and MCP keys skip.
  if (!user || !docId || user.collection !== 'users' || user.id !== docId) {
    return doc
  }

  try {
    const result = await req.payload.find({
      collection: 'subscriptions',
      where: {
        and: [
          { user: { equals: docId } },
          // Any non-terminal state. The web app wants to know about past_due
          // (so it can show a renewal-failed banner) and pending (bootstrap
          // in-flight) just as much as active.
          { status: { in: ['pending', 'active', 'past_due'] } },
        ],
      },
      // Latest by createdAt wins — covers the edge case where a user has
      // multiple historical subs (e.g. cancelled + re-subscribed).
      sort: '-createdAt',
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })

    const sub = result.docs[0] as SubscriptionDoc | undefined
    const summary: ActiveSubscriptionSummary | null = sub
      ? {
          id: sub.id,
          status: sub.status,
          tierSlug: typeof sub.tierSlug === 'string' ? sub.tierSlug : null,
          offerSlug: typeof sub.offerSlug === 'string' ? sub.offerSlug : null,
          provider: typeof sub.provider === 'string' ? sub.provider : null,
          currentPeriodEnd: sub.currentPeriodEnd
            ? new Date(sub.currentPeriodEnd).toISOString()
            : null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
          paypalSubscriptionId:
            typeof sub.paypalSubscriptionId === 'string' ? sub.paypalSubscriptionId : null,
        }
      : null

    return {
      ...doc,
      activeSubscription: summary,
    }
  } catch (err) {
    // Never let a sub lookup failure break /api/users/me — the user can
    // still log in and the UI falls back to "no active subscription".
    req.payload.logger.warn(
      { err: err instanceof Error ? err.message : String(err), userId: docId },
      '[attachActiveSubscription] subscription lookup failed; returning user without activeSubscription',
    )
    return doc
  }
}
