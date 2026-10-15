import type { Payload } from 'payload'

/**
 * Partial unique index on `subscriptions.user` filtered to the active-ish
 * statuses `{ pending, active, past_due }`.
 *
 * Why a DB-level guard: the bootstrap endpoint's application-level
 * "already-has-active-sub" check is a TOCTOU — two near-simultaneous
 * requests from the same user can both pass the `find`, then both insert
 * pending Subscriptions and dangling Transactions. A partial unique index
 * closes the window: the second insert fails with E11000 and the endpoint
 * returns 409.
 *
 * Why partial: terminal statuses (`cancelled`, `expired`, `suspended`) are
 * long-term history and must be allowed to accumulate per-user.
 *
 * Pre-flight: before creating the index, check for existing duplicates
 * (users with multiple active-ish subs). If any exist, LOG ERROR and skip
 * — Mongo would refuse to build the index on duplicate keys and ops needs
 * to resolve the dupes first.
 *
 * Idempotent: subsequent boots see the index already present and are a
 * cheap `listIndexes` call.
 *
 * Non-fatal: a failure here must not kill boot. Logs ERROR so ops can see
 * the guard is still missing.
 */
const INDEX_NAME = 'subscriptions_user_active_unique'
const ACTIVE_STATUSES = ['pending', 'active', 'past_due'] as const

export async function ensureSubscriptionsActiveUserIndex(
  payload: Payload,
): Promise<'created' | 'exists' | 'duplicates' | 'noop'> {
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/ensureSubscriptionsActiveUserIndex] payload.db.connection.db unavailable; skipping',
    )
    return 'noop'
  }

  const subs = db.collection('subscriptions')

  const indexes = (await subs.indexes()) as Array<{ name?: string }>
  if (indexes.some((idx) => idx.name === INDEX_NAME)) {
    return 'exists'
  }

  // Pre-flight dup check — look for users with more than one active-ish sub.
  const dupes = await subs
    .aggregate<{
      _id: string
      count: number
    }>(
      [
        { $match: { status: { $in: ACTIVE_STATUSES } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 20 },
      ],
      { allowDiskUse: true },
    )
    .toArray()

  if (dupes.length > 0) {
    payload.logger.error(
      {
        duplicateUserCount: dupes.length,
        sample: dupes.slice(0, 5),
      },
      '[migration/ensureSubscriptionsActiveUserIndex] users with multiple active-ish subscriptions found — refusing to build the partial unique index. Dedupe (keep the latest, terminate the losers) and redeploy.',
    )
    return 'duplicates'
  }

  await subs.createIndex(
    { user: 1 },
    {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        status: { $in: [...ACTIVE_STATUSES] },
      },
    },
  )
  payload.logger.info(
    { indexName: INDEX_NAME },
    '[migration/ensureSubscriptionsActiveUserIndex] partial unique index created',
  )
  return 'created'
}

export async function runEnsureSubscriptionsActiveUserIndexOnInit(payload: Payload): Promise<void> {
  try {
    await ensureSubscriptionsActiveUserIndex(payload)
  } catch (err) {
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/ensureSubscriptionsActiveUserIndex] failed — bootstrap double-sub guard may be missing',
    )
  }
}
