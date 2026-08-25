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
 * Per-request timing store keyed by opId. Using a Map (not a scalar slot on
 * req.context) lets concurrent reads within the same request — Payload
 * relationship population at depth > 0, RSC pages fanning parallel finds,
 * dataloader batches — each keep their own start time without stomping each
 * other. Without this, the second concurrent `beforeOperation` would
 * overwrite the first op's start, and the first `afterOperation` would then
 * measure against the wrong start → wrong ms + mismatched opId.
 */
interface OpTimingContext {
  _opTimings?: Map<string, number>
}

/**
 * Threading the opId from `beforeOperation` to `afterOperation`. Payload
 * passes the args object modified by beforeOperation through to the actual
 * operation and then to afterOperation, so a private field on args survives
 * the pair reliably regardless of async concurrency.
 */
interface OpTimingArgs {
  _diagOpId?: string
  depth?: number
  limit?: number
}

const opLog = (msg: string, fields: Record<string, unknown>): void => {
  console.log(JSON.stringify({ msg: `[op] ${msg}`, ...fields }))
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
      if (!ctx._opTimings) ctx._opTimings = new Map<string, number>()
      ctx._opTimings.set(opId, start)
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
    async ({ args, operation, result, req }) => {
      if (operation !== 'read') return result
      const opArgs = args as unknown as OpTimingArgs
      const opId = opArgs._diagOpId
      const ctx = req.context as OpTimingContext | undefined
      const start = opId ? ctx?._opTimings?.get(opId) : undefined
      if (start === undefined || !opId) return result
      ctx?._opTimings?.delete(opId)
      const docs =
        result && typeof result === 'object' && 'docs' in result && Array.isArray(result.docs)
          ? result.docs.length
          : result
            ? 1
            : 0
      opLog(`${slug}.read end`, {
        opId,
        ms: Date.now() - start,
        docs,
        depth: opArgs.depth,
        limit: opArgs.limit,
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
