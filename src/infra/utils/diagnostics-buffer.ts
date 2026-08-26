/**
 * @fileType utility
 * @domain diagnostics
 * @pattern in-memory ring buffer
 * @ai-summary Bounded in-memory buffer for [boot]/[op]/[coll] diagnostic
 *   events. Every event that's logged via `console.log` also pushes here so
 *   admins can hit `/api/diagnostics/recent-events` and see the timeline in
 *   a browser tab without waiting on Vercel log propagation. Per-lambda
 *   instance — different concurrent instances have separate buffers, so a
 *   single admin flow may span buffers depending on Vercel routing.
 */

export interface DiagEvent {
  ts: number
  msg: string
  [key: string]: unknown
}

const MAX_EVENTS = 500
const events: DiagEvent[] = []

/**
 * Push a diagnostic event onto the ring buffer. Called from the same code
 * paths that emit `[boot]`, `[op]`, and `[coll]` `console.log` lines.
 * Safe under Node's single-threaded event loop: `push` and `shift` are
 * atomic between awaits.
 */
export function pushDiagEvent(msg: string, fields: Record<string, unknown> = {}): void {
  events.push({ ts: Date.now(), msg, ...fields })
  if (events.length > MAX_EVENTS) events.shift()
}

/**
 * Snapshot of the current buffer for the diagnostics endpoint. Returns a
 * shallow copy so subsequent pushes don't mutate the returned array.
 */
export function getRecentDiagEvents(): {
  events: DiagEvent[]
  now: number
  maxEvents: number
} {
  return { events: [...events], now: Date.now(), maxEvents: MAX_EVENTS }
}
