/**
 * Unit tests for feature-quota service
 *
 * Covers the pure functions (bucket math + entitlement resolution).
 * The atomic check-and-increment path against a real MongoDB lives in the
 * integration tests because it needs the adapter wired up.
 */
import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  getDayBucketIL,
  getNextDayResetIsoIL,
  resolveFeatureEntitlement,
} from '@/server/services/feature-quota'

describe('getDayBucketIL', () => {
  it('returns YYYY-MM-DD format', () => {
    const bucket = getDayBucketIL(new Date('2026-06-15T12:00:00Z'))
    expect(bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the same bucket for two timestamps in the same Israel-day', () => {
    // 03:00 IL (UTC midnight in summer DST) and 22:00 IL same date
    const morningIL = new Date('2026-06-15T03:00:00+03:00')
    const eveningIL = new Date('2026-06-15T22:00:00+03:00')
    expect(getDayBucketIL(morningIL)).toBe(getDayBucketIL(eveningIL))
  })

  it('returns different buckets across IL midnight', () => {
    // 23:30 IL on day N vs 00:30 IL on day N+1
    const beforeMidnight = new Date('2026-06-15T23:30:00+03:00')
    const afterMidnight = new Date('2026-06-16T00:30:00+03:00')
    expect(getDayBucketIL(beforeMidnight)).not.toBe(getDayBucketIL(afterMidnight))
  })

  it('uses IL calendar, not UTC, when they straddle midnight', () => {
    // 23:00 UTC June 15 is 02:00 IL June 16 (summer) — UTC-bucketing would say June 15
    const t = new Date('2026-06-15T23:00:00Z')
    expect(getDayBucketIL(t)).toBe('2026-06-16')
  })
})

describe('getNextDayResetIsoIL', () => {
  it('returns an ISO string in the future', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const reset = getNextDayResetIsoIL(now)
    expect(new Date(reset).getTime()).toBeGreaterThan(now.getTime())
  })

  it('reset instant has a different IL bucket than now', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const reset = getNextDayResetIsoIL(now)
    expect(getDayBucketIL(new Date(reset))).not.toBe(getDayBucketIL(now))
  })

  it('one minute before the reset is still in today bucket', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const reset = getNextDayResetIsoIL(now)
    const justBefore = new Date(new Date(reset).getTime() - 60_000)
    expect(getDayBucketIL(justBefore)).toBe(getDayBucketIL(now))
  })
})

describe('resolveFeatureEntitlement', () => {
  const userId = 'user-1'
  const mockPayload = (entitlements: unknown[]): Payload =>
    ({
      findByID: vi.fn().mockResolvedValue({ featureEntitlements: entitlements }),
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    }) as unknown as Payload

  it('returns null when user has no entitlements', async () => {
    const result = await resolveFeatureEntitlement(mockPayload([]), userId, 'ai-questions')
    expect(result).toBeNull()
  })

  it('returns null when no entitlement matches the requested key', async () => {
    const result = await resolveFeatureEntitlement(
      mockPayload([{ key: 'certificate', value: null, period: 'lifetime' }]),
      userId,
      'ai-questions',
    )
    expect(result).toBeNull()
  })

  it('returns the matching entitlement when present', async () => {
    const result = await resolveFeatureEntitlement(
      mockPayload([
        {
          key: 'ai-questions',
          value: 5,
          period: 'day',
          grantedAt: '2026-06-15T12:00:00Z',
          transactionId: 'tx1',
        },
      ]),
      userId,
      'ai-questions',
    )
    expect(result).not.toBeNull()
    expect(result?.value).toBe(5)
    expect(result?.period).toBe('day')
  })

  it('filters out expired entitlements', async () => {
    const result = await resolveFeatureEntitlement(
      mockPayload([
        {
          key: 'ai-questions',
          value: 5,
          period: 'day',
          grantedAt: '2025-01-01T00:00:00Z',
          expiresAt: '2025-06-01T00:00:00Z',
        },
      ]),
      userId,
      'ai-questions',
    )
    expect(result).toBeNull()
  })

  it('picks the latest non-expired grant when multiple match', async () => {
    const result = await resolveFeatureEntitlement(
      mockPayload([
        {
          key: 'ai-questions',
          value: 5,
          period: 'day',
          grantedAt: '2026-01-01T00:00:00Z',
          transactionId: 'older',
        },
        {
          key: 'ai-questions',
          value: 10,
          period: 'day',
          grantedAt: '2026-06-01T00:00:00Z',
          transactionId: 'newer',
        },
      ]),
      userId,
      'ai-questions',
    )
    expect(result?.transactionId).toBe('newer')
    expect(result?.value).toBe(10)
  })

  it('defaults period to lifetime when missing/invalid', async () => {
    const result = await resolveFeatureEntitlement(
      mockPayload([{ key: 'ai-questions', value: 5, grantedAt: '2026-06-15T12:00:00Z' }]),
      userId,
      'ai-questions',
    )
    expect(result?.period).toBe('lifetime')
  })
})
