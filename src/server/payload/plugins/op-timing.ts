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

interface OpTimingContext {
  _opStart?: number
  _opId?: string
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
      ctx._opStart = start
      ctx._opId = opId
      opLog(`${slug}.read start`, {
        opId,
        depth: (args as { depth?: number })?.depth,
        limit: (args as { limit?: number })?.limit,
      })
      return args
    },
  ],
  afterOperation: [
    async ({ args, operation, result, req }) => {
      if (operation !== 'read') return result
      const ctx = req.context as OpTimingContext | undefined
      const start = ctx?._opStart
      const opId = ctx?._opId
      if (!start) return result
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
        depth: (args as { depth?: number })?.depth,
        limit: (args as { limit?: number })?.limit,
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
