import type { Payload } from 'payload'

/**
 * Backfill `User.tierGrantSource` for pre-Tranzilla paid users.
 *
 * Before this migration, users who purchased a tier via the one-time PayPal
 * flow have `currentTier != 'free'` but no `tierGrantSource` — the field
 * didn't exist. The subscription gate needs to distinguish those grandfathered
 * buyers from "lapsed subscriber whose sub expired," which is also a
 * `currentTier != 'free'` + no active sub state.
 *
 * Rule: `currentTier != 'free' AND tierGrantSource not set` →
 * `tierGrantSource = 'legacy_one_time'`.
 *
 * Idempotent: the `tierGrantSource not set` filter skips anyone already
 * tagged (by this migration or by extendTierSubscription). After the first
 * successful run, subsequent boots match zero docs and the migration is
 * free.
 *
 * Non-fatal: a failure here must not kill boot. Logs ERROR so ops can see
 * the backfill didn't apply.
 */
export async function backfillTierGrantSource(
  payload: Payload,
): Promise<{ matched: number; modified: number }> {
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/backfillTierGrantSource] payload.db.connection.db unavailable; skipping',
    )
    return { matched: 0, modified: 0 }
  }

  const users = db.collection('users')
  const result = await users.updateMany(
    {
      currentTier: { $exists: true, $ne: 'free' },
      $or: [{ tierGrantSource: { $exists: false } }, { tierGrantSource: null }],
    },
    { $set: { tierGrantSource: 'legacy_one_time' } },
  )

  if (result.modifiedCount > 0) {
    payload.logger.info(
      { matched: result.matchedCount, modified: result.modifiedCount },
      '[migration/backfillTierGrantSource] tagged legacy one-time tier grants',
    )
  }

  return { matched: result.matchedCount, modified: result.modifiedCount }
}

export async function runBackfillTierGrantSourceOnInit(payload: Payload): Promise<void> {
  try {
    await backfillTierGrantSource(payload)
  } catch (err) {
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/backfillTierGrantSource] failed — legacy users may be miscategorized by the gate',
    )
  }
}
