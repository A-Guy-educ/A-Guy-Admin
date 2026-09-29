import type { Payload } from 'payload'

/**
 * Reconciles the Tiers collection indexes:
 *
 * 1. Adds a partial unique index on `isDefault` that enforces "at most one
 *    row with isDefault=true" at the database layer. A plain unique index
 *    on `isDefault` won't work (it would reject the second row with
 *    isDefault=false, treating false as a duplicate); a partial unique
 *    index restricted to `{ isDefault: true }` targets exactly the
 *    invariant we want. This is the race-proof backstop for the
 *    Tiers.beforeValidate friendly-error check (which has a TOCTOU
 *    window when two admins concurrently flip defaults).
 *
 * 2. Drops any stale plain unique index on `rank`. The initial schema
 *    declared `rank: unique: true` but that blocked the natural admin
 *    reorder path (swap Pro=2 ↔ Elite=3 needs one write to temporarily
 *    duplicate a rank). The field-level `unique` is gone from the schema;
 *    on existing DBs the index lingers unless we drop it here.
 *
 * Idempotent: safe to re-run on every boot. Reconciles both indexes to
 * the desired state and no-ops when already correct.
 */
export async function ensureTiersIndexes(payload: Payload): Promise<'reconciled' | 'noop'> {
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/ensureTiersIndexes] payload.db.connection.db unavailable; skipping',
    )
    return 'noop'
  }

  const IS_DEFAULT_INDEX = 'isDefault_partial_unique'
  const tiers = db.collection('tiers')
  const existing = await tiers.indexes()

  let changed = false

  // 1. Reconcile the partial unique index on isDefault.
  const currentIsDefault = existing.find((idx) => idx.name === IS_DEFAULT_INDEX)
  const desiredSpec = { isDefault: 1 as const }
  const desiredPartial = { isDefault: true }

  const isDefaultCurrent = currentIsDefault
    ? JSON.stringify(currentIsDefault.key) === JSON.stringify(desiredSpec) &&
      currentIsDefault.unique === true &&
      JSON.stringify(currentIsDefault.partialFilterExpression ?? null) ===
        JSON.stringify(desiredPartial)
    : false

  if (currentIsDefault && !isDefaultCurrent) {
    payload.logger.info(
      { existingSpec: currentIsDefault },
      '[migration/ensureTiersIndexes] Rebuilding stale isDefault index',
    )
    await tiers.dropIndex(IS_DEFAULT_INDEX)
    changed = true
  }
  if (!isDefaultCurrent) {
    await tiers.createIndex(desiredSpec, {
      name: IS_DEFAULT_INDEX,
      unique: true,
      partialFilterExpression: desiredPartial,
    })
    payload.logger.info(
      '[migration/ensureTiersIndexes] Created partial unique index on tiers.isDefault (isDefault=true)',
    )
    changed = true
  }

  // 2. Drop any stale plain unique index on `rank` — the field is no
  // longer declared unique; retaining the index blocks the swap-two-tiers
  // reorder path.
  const staleRankIndex = existing.find((idx) => {
    if (idx.name === IS_DEFAULT_INDEX) return false
    const key = idx.key
    if (!key || typeof key !== 'object') return false
    const keyPairs = Object.entries(key)
    // Only drop a plain single-field unique on `rank` — leave any compound
    // or partial index alone (they may exist for reasons unrelated to
    // this migration).
    return (
      keyPairs.length === 1 &&
      keyPairs[0][0] === 'rank' &&
      idx.unique === true &&
      !idx.partialFilterExpression
    )
  })
  if (staleRankIndex?.name) {
    payload.logger.info(
      { droppedIndex: staleRankIndex.name },
      '[migration/ensureTiersIndexes] Dropping stale unique index on tiers.rank (schema no longer enforces uniqueness)',
    )
    await tiers.dropIndex(staleRankIndex.name)
    changed = true
  }

  return changed ? 'reconciled' : 'noop'
}

export async function runEnsureTiersIndexesOnInit(payload: Payload): Promise<void> {
  try {
    await ensureTiersIndexes(payload)
  } catch (err) {
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/ensureTiersIndexes] failed; partial unique index may be missing',
    )
  }
}
