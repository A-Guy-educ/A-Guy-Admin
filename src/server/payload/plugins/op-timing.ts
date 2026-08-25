/**
 * @fileType payload-plugin
 * @domain diagnostics
 * @pattern before-after-operation timing
 * @ai-summary Adds beforeOperation + afterOperation hooks to every collection
 *   that emit `[op] <slug>.read` timing to stdout. Diagnostic follow-up to the
 *   afterRead `[coll]` instrumentation: hook cost showed as ~0ms on a slow
 *   collection list, so the missing time must live outside per-doc hooks —
 *   this widens the lens to catch whichever collection read is actually
 *   dominating a slow admin page load.
 *
 *   Uses console.log for the same reason as [boot] and [coll]: Vercel's log
 *   ingestion drops pino stdout writes during hot request paths.
 */

import type { CollectionConfig, Config, Plugin } from 'payload'

/**
 * Per-request pending-op store. Payload's `payload.auth()` (and possibly
 * other internal call sites) invokes reads via a code path that DOES call
 * beforeOperation but does NOT preserve args mutations through to
 * afterOperation — so our `args._diagOpId` marker vanishes for those pairs
 * and afterOperation can't find its Map entry by opId. To recover, we also
 * stash the slug on the entry and, on missing opId, fall back to popping
 * the oldest pending entry for the same slug. Approximate for concurrent
 * ops on the same collection but strictly better than losing the pair.
 */
interface OpTimingEntry {
  start: number
  slug: string
}
interface OpTimingContext {
  _opTimings?: Map<string, OpTimingEntry>
}

/**
 * Threading the opId from `beforeOperation` to `afterOperation`. Payload
 * passes the args object modified by beforeOperation through to the actual
 * operation and then to afterOperation for most read paths — but see the
 * comment above for the auth-path exception, handled by the slug fallback.
 */
interface OpTimingArgs {
  _diagOpId?: string
  depth?: number
  limit?: number
}

const opLog = (msg: string, fields: Record<string, unknown>): void => {
  console.log(JSON.stringify({ msg: `[op] ${msg}`, ...fields }))
}

/**
 * Fallback: find the oldest pending entry for this slug (arg-mutation was
 * stripped, so we can't look up by opId directly). Returns the entry AND
 * its key so the caller can remove it from the Map.
 */
const popOldestForSlug = (
  timings: Map<string, OpTimingEntry>,
  slug: string,
): { opId: string; entry: OpTimingEntry } | null => {
  let oldestId: string | undefined
  let oldestEntry: OpTimingEntry | undefined
  for (const [id, entry] of timings) {
    if (entry.slug !== slug) continue
    if (!oldestEntry || entry.start < oldestEntry.start) {
      oldestId = id
      oldestEntry = entry
    }
  }
  if (!oldestId || !oldestEntry) return null
  timings.delete(oldestId)
  return { opId: oldestId, entry: oldestEntry }
}

const buildOpTimingHooks = (
  slug: string,
): {
  beforeOperation: NonNullable<CollectionConfig['hooks']>['beforeOperation']
  afterOperation: NonNullable<CollectionConfig['hooks']>['afterOperation']
} => ({
  beforeOperation: [
    async ({ args, operation, req }) => {
      if (operation !== 'read') return args
      const start = Date.now()
      const opId = crypto.randomUUID().slice(0, 8)
      const ctx = (req.context ??= {}) as OpTimingContext
      if (!ctx._opTimings) ctx._opTimings = new Map<string, OpTimingEntry>()
      ctx._opTimings.set(opId, { start, slug })
      const opArgs = args as unknown as OpTimingArgs
      opArgs._diagOpId = opId
      opLog(`${slug}.read start`, {
        opId,
        depth: opArgs.depth,
        limit: opArgs.limit,
      })
      return args
    },
  ],
  afterOperation: [
    async ({ args, result, req }) => {
      // Don't filter on `operation`: Payload passes 'read' to beforeOperation
      // (via operationToHookOperation) but the raw operation name — 'find',
      // 'findByID', 'findVersions', 'findVersionByID' — to afterOperation. So
      // `operation !== 'read'` would always early-return here. Instead we
      // gate on the presence of a pending entry (either matched via
      // `_diagOpId` in args, or via the slug fallback below).
      const opArgs = args as unknown as OpTimingArgs
      const ctx = req.context as OpTimingContext | undefined
      const timings = ctx?._opTimings
      if (!timings) return result

      const explicitOpId = opArgs._diagOpId
      let opId: string | undefined
      let entry: OpTimingEntry | undefined
      let approx = false

      if (explicitOpId && timings.has(explicitOpId)) {
        // Fast path — args survived the round trip.
        opId = explicitOpId
        entry = timings.get(explicitOpId)
        timings.delete(explicitOpId)
      } else {
        // Fallback — args._diagOpId was stripped by Payload's internal code
        // path (observed on `payload.auth()`'s user read). Pop the oldest
        // pending entry for this slug. Concurrent ops on the same slug will
        // pair approximately, which is why `approx: true` is logged.
        const popped = popOldestForSlug(timings, slug)
        if (popped) {
          opId = popped.opId
          entry = popped.entry
          approx = true
        }
      }

      if (!entry) return result

      const docs =
        result && typeof result === 'object' && 'docs' in result && Array.isArray(result.docs)
          ? result.docs.length
          : result
            ? 1
            : 0
      opLog(`${entry.slug}.read end`, {
        opId,
        ms: Date.now() - entry.start,
        docs,
        depth: opArgs.depth,
        limit: opArgs.limit,
        approx: approx || undefined,
      })
      return result
    },
  ],
})

/**
 * Payload plugin that wraps every collection with `[op]` operation timing.
 * Diagnostic-only — remove or gate behind an env var when the perf work is
 * done.
 */
export const opTimingPlugin: Plugin = (config: Config): Config => {
  const collections = (config.collections ?? []).map((c: CollectionConfig): CollectionConfig => {
    const timing = buildOpTimingHooks(c.slug)
    return {
      ...c,
      hooks: {
        ...c.hooks,
        beforeOperation: [...(c.hooks?.beforeOperation ?? []), ...(timing.beforeOperation ?? [])],
        afterOperation: [...(c.hooks?.afterOperation ?? []), ...(timing.afterOperation ?? [])],
      },
    }
  })
  return { ...config, collections }
}
