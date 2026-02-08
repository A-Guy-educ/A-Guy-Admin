/**
 * Rate Limiter Utility
 * Sliding window rate limiter with in-memory storage
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimiterConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
}

export function createSlidingWindowLimiter(config: RateLimiterConfig): {
  check: (key: string) => boolean
  getRemaining: (key: string) => number
  reset: (key: string) => void
} {
  const { windowMs, maxRequests } = config
  const store = new Map<string, RateLimitEntry>()

  function cleanup() {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      if (now >= entry.resetAt) {
        store.delete(key)
      }
    }
  }

  function getEntry(key: string): RateLimitEntry {
    const now = Date.now()
    const existing = store.get(key)

    if (!existing) {
      const newEntry: RateLimitEntry = {
        count: 0,
        resetAt: now + windowMs,
      }
      store.set(key, newEntry)
      return newEntry
    }

    if (now >= existing.resetAt) {
      const newEntry: RateLimitEntry = {
        count: 0,
        resetAt: now + windowMs,
      }
      store.set(key, newEntry)
      return newEntry
    }

    return existing
  }

  return {
    check(key: string): boolean {
      cleanup()
      const entry = getEntry(key)
      if (entry.count >= maxRequests) return false
      entry.count++
      return true
    },

    getRemaining(key: string): number {
      cleanup()
      const entry = store.get(key)
      if (!entry || Date.now() >= entry.resetAt) {
        return maxRequests
      }
      return Math.max(0, maxRequests - entry.count)
    },

    reset(key: string): void {
      store.delete(key)
    },
  }
}

/**
 * Pre-configured limiters for chat assets
 */
export const TOKEN_ROUTE_LIMITER = createSlidingWindowLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10, // 10 per minute
})

export const FINALIZE_ROUTE_LIMITER = createSlidingWindowLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 per minute
})
