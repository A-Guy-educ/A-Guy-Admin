import type { Payload } from 'payload'

/**
 * Verifies that `transactions.providerTransactionId` has no duplicate values
 * before Mongo attempts to build the new unique index.
 *
 * Context: this branch flips `providerTransactionId` from indexed-only to
 * `unique: true` to close the race where two concurrent PAYMENT.SALE.COMPLETED
 * deliveries with distinct event ids both insert renewal rows for the same
 * sale. If duplicates exist in the collection at deploy time, MongoDB refuses
 * to build the unique index and silently proceeds without it — the code-level
 * E11000 catch in the renewal handler then becomes a dead branch, and the
 * race guard is inert.
 *
 * This check runs an aggregation on every payload boot (cheap on an indexed
 * field with no dupes — just an empty group result) and logs at ERROR level
 * with a duplicate count + first few sample IDs if any are found. Ops should
 * dedupe those rows and redeploy so the index builds correctly.
 *
 * Idempotent + non-fatal: matches the existing migration pattern
 * (dropStaleCoursesValidator, etc.) where a failing migration must not kill
 * server boot. If dupes exist, the app still starts — the ERROR log is the
 * signal that ops needs to act.
 */
export async function verifyTransactionsProviderTxIdUniqueness(
  payload: Payload,
): Promise<'clean' | 'dupes' | 'noop'> {
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/verifyTransactionsProviderTxIdUniqueness] payload.db.connection.db unavailable; skipping',
    )
    return 'noop'
  }

  const dupes = await db
    .collection('transactions')
    .aggregate<{ _id: string; count: number; ids: unknown[] }>(
      [
        { $match: { providerTransactionId: { $exists: true, $ne: null } } },
        { $group: { _id: '$providerTransactionId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 20 },
      ],
      { allowDiskUse: true },
    )
    .toArray()

  if (dupes.length === 0) return 'clean'

  const sample = dupes.slice(0, 5).map((d) => ({
    providerTransactionId: d._id,
    count: d.count,
    sampleTxIds: d.ids.slice(0, 3).map((id) => String(id)),
  }))
  payload.logger.error(
    { duplicateCount: dupes.length, sample },
    '[migration/verifyTransactionsProviderTxIdUniqueness] DUPLICATE providerTransactionId VALUES FOUND. The unique index on transactions.providerTransactionId will silently fail to build, disabling the race guard in the PayPal renewal handler. Dedupe these rows (keep the succeeded/latest, delete the losers) and redeploy.',
  )
  return 'dupes'
}

export async function runVerifyTransactionsUniquenessOnInit(payload: Payload): Promise<void> {
  try {
    await verifyTransactionsProviderTxIdUniqueness(payload)
  } catch (err) {
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/verifyTransactionsProviderTxIdUniqueness] check itself failed; unique-index status unknown',
    )
  }
}
