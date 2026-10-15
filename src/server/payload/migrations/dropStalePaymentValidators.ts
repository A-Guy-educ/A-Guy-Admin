import type { Payload } from 'payload'

/**
 * Removes stale `$jsonSchema` collection-level validators from `subscriptions`
 * and `transactions`.
 *
 * Background: the live admin.dev DB has a Mongo-side validator on at least
 * one of these collections (observed as "Document failed validation" / code
 * 121 on every bootstrap request after PR #616 shipped). Payload's own
 * field validators are the single source of truth; the Mongo-level validator
 * is redundant when in sync and actively blocks legitimate inserts when it
 * isn't — exactly the shape of the problem that
 * `dropStaleCoursesValidator` was written to solve, so this is its sister
 * migration for the payments collections.
 *
 * Idempotent: only issues `collMod` if a validator is actually present on
 * a given collection, so subsequent onInit runs are a cheap
 * `listCollections` and no writes.
 */
const TARGET_COLLECTIONS = ['subscriptions', 'transactions'] as const

export async function dropStalePaymentValidators(
  payload: Payload,
): Promise<Record<string, 'dropped' | 'noop'>> {
  const result: Record<string, 'dropped' | 'noop'> = {}
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/dropStalePaymentValidators] payload.db.connection.db unavailable; skipping',
    )
    for (const name of TARGET_COLLECTIONS) result[name] = 'noop'
    return result
  }

  for (const name of TARGET_COLLECTIONS) {
    const info = await db.listCollections({ name }, { nameOnly: false }).toArray()
    const options = info[0]?.options as { validator?: unknown } | undefined
    if (!options?.validator) {
      result[name] = 'noop'
      continue
    }

    // Log the validator shape BEFORE dropping so the exact definition is
    // recoverable from server logs if it turns out we needed it.
    payload.logger.info(
      {
        collection: name,
        droppedValidator: options.validator,
        validationLevel: (options as { validationLevel?: unknown }).validationLevel,
      },
      `[migration/dropStalePaymentValidators] Found existing validator on \`${name}\`; about to drop it`,
    )

    await db.command({
      collMod: name,
      validator: {},
      validationLevel: 'off',
    })
    payload.logger.info(
      `[migration/dropStalePaymentValidators] Dropped stale $jsonSchema validator from \`${name}\``,
    )
    result[name] = 'dropped'
  }

  return result
}

export async function runDropStalePaymentValidatorsOnInit(payload: Payload): Promise<void> {
  try {
    await dropStalePaymentValidators(payload)
  } catch (err) {
    // Never let a migration failure kill server boot. If the validator
    // can't be dropped, the next bootstrap will fail the same way the
    // triggering issue did — but we won't break any other route by
    // crashing boot.
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/dropStalePaymentValidators] failed; validators (if any) are still in place',
    )
  }
}
