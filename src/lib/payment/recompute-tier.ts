/**
 * Recompute a user's current subscription tier.
 *
 * The tier is derived state — the source of truth is the set of paid grants
 * (subscriptions and one-time transactions) whose access window is still
 * open. This helper is called from Transactions afterChange hooks (on both
 * status → 'succeeded' and → 'refunded'). Callers MUST pass the request
 * (`req`) through so the reads happen inside the same MongoDB session as
 * the triggering write — otherwise the query runs outside the transaction
 * and cannot see the just-committed status change.
 *
 * Resolution:
 *   1. Active subscriptions      — Subscriptions.status='active', or
 *                                  ('cancelled' AND currentPeriodEnd > now
 *                                  AND cancelAtPeriodEnd=true).
 *   2. Live one-time purchases   — Transactions.status='succeeded',
 *                                  isRenewal!=true, and either the product
 *                                  has no durationDays (lifetime) or
 *                                  createdAt + durationDays > now.
 *   3. For each contributing Product, take its Tier.
 *   4. Highest-rank tier wins.
 *   5. If no active grants have a tier, fall back to the Tier row flagged
 *      `isDefault: true` (Free). If no default exists, leave currentTier
 *      unchanged and log — permission checks must handle that case.
 *
 * Concurrency: writes go through a compare-and-swap loop keyed on the
 * user's existing `currentTier`. Two parallel hooks (e.g. Stripe refund
 * + PayPal grant on the same user) may each read a different grant
 * snapshot; the losing writer detects the CAS miss and retries against
 * fresh state, so a lower-tier write from a stale snapshot cannot
 * clobber a higher-tier write from a newer snapshot.
 *
 * @fileType utility
 * @domain billing
 * @pattern derived-state, recompute, cas-retry
 * @ai-summary Derives user.currentTier from active subscriptions + one-time transactions; highest-rank wins; CAS-guarded write; req threaded so reads see the same tx session
 */

import { ObjectId, type Collection, type Db, type Document } from 'mongodb'
import type { Payload, PayloadRequest } from 'payload'

interface TierRow {
  id: string
  slug?: string
  rank: number
  isDefault?: boolean
}

interface ProductRow {
  id: string
  tier?: string | TierRow | null
  durationDays?: number | null
}

interface SubscriptionRow {
  id: string
  product?: string | { id: string } | null
  status?: string
  currentPeriodEnd?: string | null
  cancelAtPeriodEnd?: boolean
}

interface TransactionRow {
  id: string
  product?: string | { id: string } | null
  createdAt?: string
  subscription?: string | { id: string } | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const CAS_MAX_ATTEMPTS = 5

// Defensive caps on the subs/txs fan-out reads. Recompute runs on the
// webhook critical path with a small Mongo pool (maxPoolSize=3); a
// user with pathological history (many renewals or admin-seeded rows)
// would otherwise pull every row into memory and stall the pool. Real
// users should be nowhere near these — hitting either limit logs a
// warn so ops can chase the outlier.
const MAX_SUBS_PER_USER = 200
const MAX_TXS_PER_USER = 500

function idOf(rel: string | { id: string } | null | undefined): string | null {
  if (!rel) return null
  return typeof rel === 'string' ? rel : rel.id
}

/**
 * Compute the winning tier for a user based on committed grant state.
 * Returns the Tier row to write, or null if no default exists to fall
 * back to (caller preserves existing value).
 */
async function resolveWinningTier(
  payload: Payload,
  userId: string,
  req: PayloadRequest | undefined,
): Promise<TierRow | null> {
  const nowIso = new Date().toISOString()
  const nowMs = Date.now()

  // 1. Live subscription grants — the sub filter is the AUTHORITATIVE
  // source for subscription-derived tier grants:
  //  - `active`             — normal in-period state
  //  - `past_due`           — payment failing but access continues during grace
  //  - `cancelled` + within period (cancelAtPeriodEnd=true, currentPeriodEnd
  //     in the future) — user cancelled but paid through the end of the
  //     current period.
  // Terminal states (`expired`, `suspended`, `cancelled` past the period end)
  // are excluded here; the tx loop below MUST skip any tx linked to a
  // subscription so those subs don't leak lifetime grants via their initial
  // succeeded tx (which is never refunded — only the sub row is flipped).
  const subs = await payload.find({
    collection: 'subscriptions',
    where: {
      and: [
        { user: { equals: userId } },
        {
          or: [
            { status: { equals: 'active' } },
            { status: { equals: 'past_due' } },
            {
              and: [
                { status: { equals: 'cancelled' } },
                { cancelAtPeriodEnd: { equals: true } },
                { currentPeriodEnd: { greater_than: nowIso } },
              ],
            },
          ],
        },
      ],
    },
    limit: MAX_SUBS_PER_USER,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (subs.totalDocs > MAX_SUBS_PER_USER) {
    payload.logger.warn(
      { userId, totalDocs: subs.totalDocs, capped: MAX_SUBS_PER_USER },
      'recomputeUserTier: active-subs count exceeded cap; tier may be under-derived for this user',
    )
  }

  // 2. Live one-time transactions — succeeded, non-renewal. Sub-linked
  // txs are filtered out below (application-side, so behaviour is
  // insensitive to whether Payload stores an unset relationship as
  // missing or null). durationDays expiry is also applied per-tx below
  // because it needs createdAt + durationDays arithmetic that Payload's
  // where syntax cannot express directly.
  const txs = await payload.find({
    collection: 'transactions',
    where: {
      and: [
        { user: { equals: userId } },
        { status: { equals: 'succeeded' } },
        { isRenewal: { not_equals: true } },
      ],
    },
    limit: MAX_TXS_PER_USER,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (txs.totalDocs > MAX_TXS_PER_USER) {
    payload.logger.warn(
      { userId, totalDocs: txs.totalDocs, capped: MAX_TXS_PER_USER },
      'recomputeUserTier: succeeded-txs count exceeded cap; tier may be under-derived for this user',
    )
  }

  const productIds = new Set<string>()
  for (const row of subs.docs as SubscriptionRow[]) {
    const pid = idOf(row.product ?? null)
    if (pid) productIds.add(pid)
  }
  for (const row of txs.docs as TransactionRow[]) {
    // Skip sub-linked txs — their tier grant is governed by the sub filter
    // above. A subscription that has expired keeps its initial succeeded
    // tx (only the sub row flips to 'expired'); counting it here would
    // grant lifetime tier to users whose subscription has ended.
    if (row.subscription) continue
    const pid = idOf(row.product ?? null)
    if (pid) productIds.add(pid)
  }
  if (productIds.size === 0) {
    return getDefaultTier(payload, req)
  }

  // Batch-fetch products in one query rather than N sequential findByIDs.
  // This runs on the webhook critical path with pool cap 3; N+1 previously
  // multiplied a 3-product user by 3-4 round trips.
  const products = await payload.find({
    collection: 'products',
    where: { id: { in: Array.from(productIds) } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const productTierId = new Map<string, string>()
  const productDurationDays = new Map<string, number | null>()
  for (const row of products.docs as ProductRow[]) {
    const tierId = idOf(row.tier ?? null)
    productDurationDays.set(row.id, row.durationDays ?? null)
    if (tierId) productTierId.set(row.id, tierId)
  }

  const activeTierIds = new Set<string>()
  for (const _row of subs.docs as SubscriptionRow[]) {
    const pid = idOf(_row.product ?? null)
    if (!pid) continue
    const tierId = productTierId.get(pid)
    if (tierId) activeTierIds.add(tierId)
  }
  for (const row of txs.docs as TransactionRow[]) {
    // Same skip as above — the sub filter already contributed this tier
    // (or not, if the sub is in a terminal state).
    if (row.subscription) continue
    const pid = idOf(row.product ?? null)
    if (!pid) continue
    const durationDays = productDurationDays.get(pid) ?? null
    if (durationDays != null && durationDays > 0) {
      const created = row.createdAt ? Date.parse(row.createdAt) : NaN
      if (!Number.isFinite(created)) continue
      if (created + durationDays * MS_PER_DAY <= nowMs) continue
    }
    const tierId = productTierId.get(pid)
    if (tierId) activeTierIds.add(tierId)
  }

  if (activeTierIds.size === 0) {
    return getDefaultTier(payload, req)
  }

  const tiers = await payload.find({
    collection: 'tiers',
    where: { id: { in: Array.from(activeTierIds) } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })

  let winner: TierRow | null = null
  for (const row of tiers.docs as TierRow[]) {
    if (!winner || row.rank > winner.rank) winner = row
  }

  if (winner && tiers.docs.length > 1) {
    payload.logger.info(
      { userId, activeTierCount: tiers.docs.length, winnerRank: winner.rank },
      'recomputeUserTier: user has multiple active tier grants — resolving to highest rank',
    )
  }

  return winner ?? (await getDefaultTier(payload, req))
}

async function getDefaultTier(
  payload: Payload,
  req: PayloadRequest | undefined,
): Promise<TierRow | null> {
  const defaults = await payload.find({
    collection: 'tiers',
    where: { isDefault: { equals: true } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return defaults.docs.length > 0 ? (defaults.docs[0] as TierRow) : null
}

/**
 * @param payload   the payload instance
 * @param userId    the user whose tier is being recomputed
 * @param req       (recommended) the request driving the call — passed
 *                  through to all `payload.find` calls so the reads share
 *                  the same MongoDB session as the caller's write. Omit
 *                  ONLY when calling from outside a request context (e.g.
 *                  a cron sweep). Without it, the reads run outside any
 *                  active transaction and may miss uncommitted state.
 */
export async function recomputeUserTier(
  payload: Payload,
  userId: string,
  req?: PayloadRequest,
): Promise<void> {
  // Use the raw MongoDB Collection (not the Mongoose model at
  // payload.db.collections['users']) so the CAS read + write bypass any
  // session that Mongoose may have implicitly attached from the calling
  // hook context. The tier write is derived state and does not need to
  // participate in the caller's transaction — but the CAS read MUST see
  // globally committed state to detect concurrent hook updates.
  const db = (payload.db as unknown as { connection?: { db?: Db } }).connection?.db
  if (!db) {
    payload.logger.error(
      { userId },
      'recomputeUserTier: raw MongoDB connection unavailable; cannot write currentTier',
    )
    return
  }
  const usersCollection: Collection<Document> = db.collection<Document>('users')
  const userObjectId = new ObjectId(userId)

  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    // Read the user's currentTier as the CAS token BEFORE computing. If a
    // concurrent hook updates currentTier between our read and write, our
    // update's filter no longer matches → we retry with fresh state.
    const priorDoc = (await usersCollection.findOne(
      { _id: userObjectId },
      { projection: { currentTier: 1 } },
    )) as { currentTier?: ObjectId | string | null } | null

    if (!priorDoc) {
      payload.logger.warn({ userId }, 'recomputeUserTier: user not found; skipping')
      return
    }

    const priorTier = priorDoc.currentTier ?? null

    const winner = await resolveWinningTier(payload, userId, req)
    if (!winner) {
      payload.logger.warn(
        { userId },
        'recomputeUserTier: no default (isDefault=true) tier is seeded — leaving user.currentTier untouched',
      )
      return
    }

    const winnerObjectId = new ObjectId(winner.id)

    // No-op if the resolved tier already matches — nothing to write.
    if (priorTier && String(priorTier) === winner.id) return

    // CAS filter: only update when currentTier still equals what we read.
    // A concurrent write (another webhook, admin edit) invalidates the
    // filter and the update becomes a no-op; we loop back for a fresh
    // read + recompute.
    const casFilter: Record<string, unknown> =
      priorTier === null
        ? { _id: userObjectId, $or: [{ currentTier: { $exists: false } }, { currentTier: null }] }
        : { _id: userObjectId, currentTier: normalizeCasValue(priorTier) }

    // Refresh updatedAt alongside currentTier so admins auditing the User
    // row see the tier change reflected in the "last modified" column.
    // The raw driver write bypasses Mongoose's timestamp middleware, so
    // we have to bump it explicitly.
    const result = await usersCollection.updateOne(casFilter, {
      $set: { currentTier: winnerObjectId, updatedAt: new Date() },
    })

    if (result.matchedCount === 1) return

    payload.logger.info(
      { userId, attempt: attempt + 1 },
      'recomputeUserTier: CAS mismatch, retrying with fresh state',
    )
  }

  payload.logger.error(
    { userId },
    `recomputeUserTier: CAS retries exhausted (${CAS_MAX_ATTEMPTS} attempts) — currentTier may be stale`,
  )
}

function normalizeCasValue(value: ObjectId | string): ObjectId | string {
  if (value instanceof ObjectId) return value
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value)
  return value
}
