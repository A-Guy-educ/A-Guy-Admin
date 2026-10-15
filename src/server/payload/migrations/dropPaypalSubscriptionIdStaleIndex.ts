import type { Payload } from 'payload'

/**
 * Drop the legacy non-sparse unique index on `subscriptions.paypalSubscriptionId`.
 *
 * Background: PR #267 defined `paypalSubscriptionId` as `required + unique`,
 * which produced a standard Mongo unique index. When we widened the
 * Subscriptions schema to support Tranzilla tier subs (which carry no
 * paypalSubscriptionId), the field became optional. Standard unique indexes
 * treat missing values as a single null — so the second Tranzilla sub
 * insert would collide on null and fail with E11000.
 *
 * Fix: drop `unique: true` from the schema (so Payload rebuilds a plain
 * non-unique secondary index on next boot) and drop the stale unique index
 * at boot via this migration. PayPal-side uniqueness is enforced at the
 * webhook handler via lookup-then-insert; collision is essentially
 * impossible because PayPal issues one sub id per subscription.
 *
 * Idempotent: checks the live index list and only drops if a non-sparse
 * unique index on `paypalSubscriptionId` still exists. On subsequent
 * boots the function is a no-op `listIndexes`.
 *
 * Non-fatal: a failure here must not kill boot. Logs ERROR so ops can see
 * the stale index is still in place.
 */
export async function dropPaypalSubscriptionIdStaleIndex(
  payload: Payload,
): Promise<'dropped' | 'noop'> {
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/dropPaypalSubscriptionIdStaleIndex] payload.db.connection.db unavailable; skipping',
    )
    return 'noop'
  }

  const indexes = (await db.collection('subscriptions').indexes()) as Array<{
    name?: string
    key?: Record<string, number>
    unique?: boolean
    sparse?: boolean
  }>

  const staleIndex = indexes.find(
    (idx) =>
      idx.unique === true && idx.sparse !== true && idx.key && idx.key.paypalSubscriptionId === 1,
  )

  if (!staleIndex || !staleIndex.name) {
    return 'noop'
  }

  await db.collection('subscriptions').dropIndex(staleIndex.name)
  payload.logger.info(
    { indexName: staleIndex.name },
    '[migration/dropPaypalSubscriptionIdStaleIndex] dropped stale non-sparse unique index',
  )
  return 'dropped'
}

export async function runDropPaypalSubscriptionIdStaleIndexOnInit(payload: Payload): Promise<void> {
  try {
    await dropPaypalSubscriptionIdStaleIndex(payload)
  } catch (err) {
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/dropPaypalSubscriptionIdStaleIndex] failed — stale index may still be in place',
    )
  }
}
