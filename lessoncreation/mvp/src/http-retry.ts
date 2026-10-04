/**
 * Exponential-backoff retry wrapper for Gemini API calls. Google's platform
 * occasionally returns transient 503/429 errors when the model is overloaded
 * ("high demand" spikes) or when we bump against per-minute rate limits.
 * Long unattended runs (e.g. overnight corpus regeneration) need to survive
 * these blips without failing entire lessons.
 *
 * Backoff schedule: 5s, 15s, 45s, 135s, 405s (max ~10 min total wait before
 * giving up). 5 attempts total including the initial one. Only retries on
 * error signatures that indicate a TRANSIENT server-side issue — 4xx auth
 * errors, schema violations, and malformed prompts throw immediately.
 */

const BACKOFF_DELAYS_MS = [5_000, 15_000, 45_000, 135_000, 405_000]
// 7 attempts total → 5s + 15s + 45s + 135s + 405s + 405s + 405s = ~24 min
// of retry budget. Bumped from 5 after observing Google Flash 3.8 outages
// that outlasted the 5-attempt (~10 min) budget during overnight batches.
const DEFAULT_MAX_ATTEMPTS = 7

function isRetriableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  // Explicit HTTP-code signals in the Google GenAI SDK error strings.
  if (/\[503\b/.test(msg)) return true // Service Unavailable
  if (/\[429\b/.test(msg)) return true // Too Many Requests
  if (/\[502\b/.test(msg)) return true // Bad Gateway
  if (/\[504\b/.test(msg)) return true // Gateway Timeout
  // Semantic phrases the API returns even when the code is present.
  if (/service unavailable/i.test(msg)) return true
  if (/high demand/i.test(msg)) return true
  if (/temporarily unavailable/i.test(msg)) return true
  if (/rate limit/i.test(msg)) return true
  // Node network errors during the fetch — worth retrying.
  if (/ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|EPIPE|socket hang up/i.test(msg)) return true
  // Generic "fetch failed" from Node's undici fetch — cause is inside the
  // `cause` chain, but the outer message is enough to warrant a retry.
  if (/fetch failed/i.test(msg)) return true
  // Malformed JSON — Gemini sometimes returns invalid or partial JSON,
  // often at the same rate as 503s (both are load-related). Worth retrying.
  if (/Gemini returned non-JSON output/i.test(msg)) return true
  // Schema-validation failures on the JSON — usually the model dropped a
  // required field or emitted the wrong shape. Half of these clear on
  // retry (transient), half are prompt bugs — retry once but no more.
  if (/schema validation/i.test(msg)) return true
  return false
}

export interface WithHttpRetryOptions {
  /** Human-readable label for retry log lines. */
  label?: string
  /** Total attempts including the first. Default 5. */
  maxAttempts?: number
}

export async function withHttpRetry<T>(
  fn: () => Promise<T>,
  opts: WithHttpRetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const label = opts.label ?? 'gemini call'
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRetriableError(err) || attempt === maxAttempts) throw err
      const delayMs = BACKOFF_DELAYS_MS[Math.min(attempt - 1, BACKOFF_DELAYS_MS.length - 1)]
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[${label}] attempt ${attempt}/${maxAttempts} — transient error, retrying in ${delayMs / 1000}s: ${msg.slice(0, 140)}…`,
      )
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError
}
