/**
 * @fileType utility
 * @domain diagnostics
 * @pattern hook-wrapper
 * @ai-summary Wraps a Payload afterRead hook to emit [coll] timing to stdout so
 *   Vercel Runtime Logs can be grepped for per-hook cost on collection reads.
 *   Uses console.log for the same reason as [boot] instrumentation: Vercel
 *   coalesces pino writes on hot paths and drops intermediate lines; raw
 *   console.log survives ingestion.
 */

import type { CollectionAfterReadHook } from 'payload'

import { pushDiagEvent } from '@/infra/utils/diagnostics-buffer'

interface CollLogFields {
  ms: number
  findMany: boolean
  docId?: string
  err?: { message: string; stack?: string } | string
}

const collLog = (msg: string, fields: CollLogFields): void => {
  const prefixed = `[coll] ${msg}`
  console.log(JSON.stringify({ msg: prefixed, ...fields }))
  pushDiagEvent(prefixed, fields as unknown as Record<string, unknown>)
}

/**
 * Wraps an afterRead hook with `[coll] <name>` timing. Behavior of the wrapped
 * hook is unchanged: same args, same return, same error propagation.
 *
 * Grep Vercel Runtime Logs for `[coll]` to see the per-hook, per-doc cost
 * breakdown of any collection request.
 *
 * @example
 *   afterRead: [
 *     timedAfterRead('lessons.populateAdminTitle', populateLessonAdminTitle),
 *     timedAfterRead('lessons.backfillCourse', async ({ doc, req }) => { ... }),
 *   ]
 */
export function timedAfterRead(
  name: string,
  hook: CollectionAfterReadHook,
): CollectionAfterReadHook {
  return async (args) => {
    const start = Date.now()
    try {
      const result = await hook(args)
      const doc = result as { id?: string } | null | undefined
      collLog(name, {
        ms: Date.now() - start,
        findMany: args.findMany === true,
        docId: doc?.id,
      })
      return result
    } catch (err) {
      collLog(`${name} FAILED`, {
        ms: Date.now() - start,
        findMany: args.findMany === true,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      })
      throw err
    }
  }
}
