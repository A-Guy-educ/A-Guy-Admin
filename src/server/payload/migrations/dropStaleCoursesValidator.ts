import type { Payload } from 'payload'

/**
 * Removes the stale `$jsonSchema` collection-level validator from the
 * `courses` collection.
 *
 * Background: at some point in the past a Mongo-side validator was attached
 * to `courses` that required a `pageAccessType` field. That field has since
 * been removed from the Payload schema (see git log for Courses.ts), but the
 * validator lingered on the DB and rejected every legitimate insert with
 * `MongoServerError code 121 "Document failed validation"`. This surfaced
 * loudly when the content-promotion import started running against an env
 * that still had the validator — every course insert failed, leaving
 * orphaned chapters/lessons/exercises with dangling `course` refs.
 *
 * Payload's own field validators are the single source of truth for
 * document shape; the Mongo-level validator is redundant when in sync and
 * actively harmful when it isn't. Dropping it removes the divergence.
 *
 * Idempotent: only issues `collMod` if a validator is actually present, so
 * subsequent onInit runs are a single `listCollections` and no writes.
 */
export async function dropStaleCoursesValidator(payload: Payload): Promise<'dropped' | 'noop'> {
  const db = payload.db.connection.db
  if (!db) {
    payload.logger.warn(
      '[migration/dropStaleCoursesValidator] payload.db.connection.db unavailable; skipping',
    )
    return 'noop'
  }

  const info = await db.listCollections({ name: 'courses' }, { nameOnly: false }).toArray()
  const options = info[0]?.options as { validator?: unknown } | undefined
  if (!options?.validator) return 'noop'

  await db.command({
    collMod: 'courses',
    validator: {},
    validationLevel: 'off',
  })
  payload.logger.info(
    '[migration/dropStaleCoursesValidator] Dropped stale $jsonSchema validator from `courses`',
  )
  return 'dropped'
}

export async function runDropStaleCoursesValidatorOnInit(payload: Payload): Promise<void> {
  try {
    await dropStaleCoursesValidator(payload)
  } catch (err) {
    // Never let a migration failure kill server boot — worst case the
    // validator stays and the next import fails the same way, but the app
    // still serves traffic.
    payload.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[migration/dropStaleCoursesValidator] failed; validator (if any) is still in place',
    )
  }
}
