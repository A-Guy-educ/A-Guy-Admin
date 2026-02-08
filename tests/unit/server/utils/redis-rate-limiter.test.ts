/**
 * Redis Rate Limiter Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Mock @vercel/kv before any imports
const mockKvGet = vi.fn()
const mockKvSet = vi.fn()
const mockKvDel = vi.fn()

vi.doMock('@vercel/kv', () => ({
  kv: {
    get: mockKvGet,
    set: mockKvSet,
    del: mockKvDel,
  },
}))

// Clear module cache and import after mocking
vi.resetModules()

describe('RedisRateLimiter', () => {
  const originalDateNow = Date.now
  let createRedisSlidingWindowLimiter: typeof import('@/server/utils/redis-rate-limiter').createRedisSlidingWindowLimiter

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockImplementation(() => 1000000)

    // Re-import the module to get fresh state with mocks
    const rlModule = await import('@/server/utils/redis-rate-limiter')
    createRedisSlidingWindowLimiter = rlModule.createRedisSlidingWindowLimiter
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Date.now = originalDateNow
  })

  describe('check', () => {
    it('should allow first request', async () => {
      mockKvGet.mockResolvedValue(null)
      mockKvSet.mockResolvedValue('OK')

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const result = await limiter.check('user:123')
      expect(result).toBe(true)
      expect(mockKvSet).toHaveBeenCalledWith(
        'test:ratelimit:user:123',
        expect.objectContaining({ count: 1 }),
      )
    })

    it('should allow requests within limit', async () => {
      mockKvGet.mockResolvedValue({ count: 5, resetAt: 1000000 + 60000 })
      mockKvSet.mockResolvedValue('OK')

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const result = await limiter.check('user:123')
      expect(result).toBe(true)
      expect(mockKvSet).toHaveBeenCalledWith(
        'test:ratelimit:user:123',
        expect.objectContaining({ count: 6 }),
      )
    })

    it('should deny requests at limit', async () => {
      mockKvGet.mockResolvedValue({ count: 10, resetAt: 1000000 + 60000 })

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const result = await limiter.check('user:123')
      expect(result).toBe(false)
      expect(mockKvSet).not.toHaveBeenCalled()
    })

    it('should reset count when window expires', async () => {
      mockKvGet.mockResolvedValue({ count: 10, resetAt: 900000 })
      mockKvSet.mockResolvedValue('OK')

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const result = await limiter.check('user:123')
      expect(result).toBe(true)
      expect(mockKvSet).toHaveBeenCalledWith(
        'test:ratelimit:user:123',
        expect.objectContaining({ count: 1 }),
      )
    })

    it('should handle Redis errors gracefully and allow request', async () => {
      mockKvGet.mockRejectedValue(new Error('Redis connection failed'))

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const result = await limiter.check('user:123')
      expect(result).toBe(true)
      expect(mockKvSet).not.toHaveBeenCalled()
    })
  })

  describe('getRemaining', () => {
    it('should return maxRequests for non-existent key', async () => {
      mockKvGet.mockResolvedValue(null)

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const remaining = await limiter.getRemaining('user:123')
      expect(remaining).toBe(10)
    })

    it('should return remaining requests', async () => {
      mockKvGet.mockResolvedValue({ count: 3, resetAt: 1000000 + 60000 })

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const remaining = await limiter.getRemaining('user:123')
      expect(remaining).toBe(7)
    })

    it('should return 0 when at limit', async () => {
      mockKvGet.mockResolvedValue({ count: 10, resetAt: 1000000 + 60000 })

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const remaining = await limiter.getRemaining('user:123')
      expect(remaining).toBe(0)
    })

    it('should return maxRequests when window expired', async () => {
      mockKvGet.mockResolvedValue({ count: 10, resetAt: 900000 })

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const remaining = await limiter.getRemaining('user:123')
      expect(remaining).toBe(10)
    })

    it('should handle Redis errors gracefully', async () => {
      mockKvGet.mockRejectedValue(new Error('Redis error'))

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      const remaining = await limiter.getRemaining('user:123')
      expect(remaining).toBe(10)
    })
  })

  describe('reset', () => {
    it('should delete the rate limit key', async () => {
      mockKvDel.mockResolvedValue(1)

      const limiter = createRedisSlidingWindowLimiter({
        windowMs: 60000,
        maxRequests: 10,
        prefix: 'test',
      })

      await limiter.reset('user:123')
      expect(mockKvDel).toHaveBeenCalledWith('test:ratelimit:user:123')
    })
  })
})
