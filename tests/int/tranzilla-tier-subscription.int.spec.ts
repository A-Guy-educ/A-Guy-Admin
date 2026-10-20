// @vitest-environment node
/**
 * Integration tests: Tranzilla tier-subscription lifecycle
 *
 * Covers:
 *   - extendTierSubscription writes tier + token-reset + Sub rollforward
 *   - POST /api/subscriptions/bootstrap/tranzilla happy path + rejections
 *   - Tranzilla webhook subscription branch (approved + declined bootstrap)
 *   - sweepTranzillaRenewals: due-charge success, decline-with-retry, max-retry
 *     expiration, soft-cancel expiration
 *   - PATCH /api/subscriptions/[id]/cancel soft-cancel semantics
 *
 * @fileType integration-test
 * @domain payments
 * @pattern tier-subscription-lifecycle
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'

import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'
import { extendTierSubscription } from '@/lib/payment/extend-tier-subscription'
import { TIER_LLM_TOKEN_CAP_MONTHLY } from '@/lib/tiers/constants'

// Mock the Tranzilla direct-charge API — the cron tests exercise success and
// decline paths without hitting Tranzilla's real endpoint. The webhook tests
// go through the signed-body parsing path and don't hit the API.
vi.mock('@/lib/payment/tranzilla', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/payment/tranzilla')>('@/lib/payment/tranzilla')
  return {
    ...actual,
    chargeTranzillaToken: vi.fn(),
  }
})

// Mock the Tranzila V2 REST client — the user-cancel tests need to assert
// that cancelStandingOrder was (or was not) called, and we never want
// tests to hit the real api.tranzila.com endpoint. Default resolves to
// error_code 0 (success); individual tests override per-call.
vi.mock('@/lib/payment/tranzila-v2-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payment/tranzila-v2-client')>(
    '@/lib/payment/tranzila-v2-client',
  )
  return {
    ...actual,
    cancelStandingOrder: vi.fn().mockResolvedValue({
      httpStatus: 200,
      errorCode: 0,
      message: null,
      body: {},
      rawText: '',
      contentType: 'application/json',
    }),
    swapStandingOrderItems: vi.fn().mockResolvedValue({
      httpStatus: 200,
      errorCode: 0,
      message: 'Success',
      body: {},
      rawText: '',
      contentType: 'application/json',
    }),
  }
})

let payload: Payload
let originalDatabaseUrl: string | undefined
let tenantId: string
let userId: string
let userEmail: string

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL
  // @ts-expect-error: TypeScript doesn't allow delete on process.env
  delete process.env.DATABASE_URL

  const mongoUri = await startMongoContainer()
  process.env.DATABASE_URL = mongoUri

  // Env the Tranzilla checkout helper reads (bootstrap test only needs the
  // terminal names set; it never calls the real API).
  process.env.TRANZILLA_TERMINAL = 'test-terminal'
  process.env.TRANZILLA_TERMINAL_TOKEN = 'test-terminal-token'
  process.env.TRANZILLA_PUBLIC_KEY = 'test-public-key'
  process.env.TRANZILLA_PRIVATE_KEY = 'test-private-key'
  process.env.TRANZILLA_SANDBOX = 'true'
  process.env.NEXT_PUBLIC_SERVER_URL = 'http://localhost:3000'

  const config = await import('@payload-config')
  payload = await getPayload({ config: config.default })

  const tenant = await payload.create({
    collection: 'tenants',
    data: { name: `tz-sub-${Date.now()}`, slug: `tz-sub-${Date.now()}` } as any,
    overrideAccess: true,
  })
  tenantId = tenant.id
}, 120_000)

afterAll(async () => {
  if (payload?.db?.destroy) await payload.db.destroy()
  await stopMongoContainer()
  if (originalDatabaseUrl !== undefined) {
    process.env.DATABASE_URL = originalDatabaseUrl
  } else {
    // @ts-expect-error: TypeScript doesn't allow delete on process.env
    delete process.env.DATABASE_URL
  }
}, 120_000)

beforeEach(async () => {
  // Fresh user per test — avoids tier-state carrying between cases.
  userEmail = `tz-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`
  const user = await payload.create({
    collection: 'users',
    data: {
      email: userEmail,
      password: 'test-password-123!',
      name: 'Tranzilla Test User',
      tenant: tenantId,
    } as any,
    overrideAccess: true,
  })
  userId = user.id
})

afterEach(async () => {
  const subs = await payload.find({
    collection: 'subscriptions',
    where: { user: { equals: userId } },
    limit: 100,
    overrideAccess: true,
  })
  for (const s of subs.docs) {
    await payload.delete({ collection: 'subscriptions', id: s.id, overrideAccess: true })
  }
  const txs = await payload.find({
    collection: 'transactions',
    where: { user: { equals: userId } },
    limit: 100,
    overrideAccess: true,
  })
  for (const t of txs.docs) {
    await payload.delete({ collection: 'transactions', id: t.id, overrideAccess: true })
  }
  const whEvents = await payload.find({
    collection: 'webhook-events',
    where: { provider: { equals: 'tranzilla' } },
    limit: 100,
    overrideAccess: true,
  })
  for (const w of whEvents.docs) {
    await payload.delete({ collection: 'webhook-events', id: w.id, overrideAccess: true })
  }
  await payload.delete({ collection: 'users', id: userId, overrideAccess: true })
})

async function createPendingSub(args: {
  tierSlug: 'basic' | 'advanced' | 'premium'
  offerSlug: 'default' | 'intro3mo'
  cardToken?: string
  introChargesUsed?: number
  currentPeriodEnd?: Date
  status?: string
  cancelAtPeriodEnd?: boolean
  stoId?: string | null
}) {
  const introPriceIls = args.offerSlug === 'intro3mo' ? 33 : null
  const introChargesTotal = args.offerSlug === 'intro3mo' ? 3 : null
  const regularPriceIls = args.tierSlug === 'basic' ? 59 : args.tierSlug === 'advanced' ? 119 : 239

  const tx = await payload.create({
    collection: 'transactions',
    data: {
      tenant: tenantId,
      user: userId,
      tierSlug: args.tierSlug,
      provider: 'tranzilla',
      providerTransactionId: `tz-pending-${new ObjectId().toHexString()}`,
      status: 'pending',
      amount: (introPriceIls ?? regularPriceIls) * 100,
      currency: 'ILS',
    } as any,
    overrideAccess: true,
  })

  const sub = await payload.create({
    collection: 'subscriptions',
    data: {
      tenant: tenantId,
      user: userId,
      tierSlug: args.tierSlug,
      provider: 'tranzilla',
      offerSlug: args.offerSlug,
      introPriceIls,
      introChargesTotal,
      introChargesUsed: args.introChargesUsed ?? 0,
      regularPriceIls,
      status: args.status ?? 'pending',
      initialTransaction: tx.id,
      ...(args.cardToken ? { tranzillaCardToken: args.cardToken } : {}),
      ...(args.currentPeriodEnd ? { currentPeriodEnd: args.currentPeriodEnd.toISOString() } : {}),
      ...(args.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: args.cancelAtPeriodEnd }
        : {}),
      ...(args.stoId !== undefined ? { stoId: args.stoId } : {}),
    } as any,
    overrideAccess: true,
  })

  return { tx, sub }
}

describe('extendTierSubscription', () => {
  it('promotes the user, resets tokens, and rolls the Sub forward', async () => {
    const { sub } = await createPendingSub({ tierSlug: 'basic', offerSlug: 'intro3mo' })

    // Seed a nonzero llmTokensUsed to prove we reset it.
    const usersColl = payload.db.collections['users']
    await usersColl.updateOne({ _id: new ObjectId(userId) }, { $set: { llmTokensUsed: 123_456 } })

    const now = new Date('2026-01-15T10:00:00Z')
    const periodEnd = new Date('2026-02-15T10:00:00Z')
    await extendTierSubscription({
      payload,
      userId,
      tierSlug: 'basic',
      subscriptionId: sub.id,
      newPeriodStart: now,
      newPeriodEnd: periodEnd,
      isIntroCharge: true,
      order: 'bootstrap',
    })

    const user = (await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    })) as any
    expect(user.currentTier).toBe('basic')
    expect(user.llmTokensLimit).toBe(TIER_LLM_TOKEN_CAP_MONTHLY.basic)
    expect(user.llmTokensUsed).toBe(0)
    expect(user.tierGrantSource).toBe('subscription')
    expect(String(user.tierGrantSubscriptionId)).toBe(String(sub.id))
    expect(new Date(user.llmTokensResetAt).toISOString()).toBe(periodEnd.toISOString())

    const refreshedSub = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshedSub.status).toBe('active')
    expect(new Date(refreshedSub.currentPeriodEnd).toISOString()).toBe(periodEnd.toISOString())
    expect(refreshedSub.introChargesUsed).toBe(1)
    expect(refreshedSub.tranzillaRetryCount).toBe(0)
  })

  it('does not advance introChargesUsed on a regular charge', async () => {
    const { sub } = await createPendingSub({ tierSlug: 'basic', offerSlug: 'default' })

    await extendTierSubscription({
      payload,
      userId,
      tierSlug: 'basic',
      subscriptionId: sub.id,
      newPeriodStart: new Date(),
      newPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isIntroCharge: false,
      order: 'bootstrap',
    })

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.introChargesUsed).toBe(0)
  })

  it('is idempotent per-period: replay does not re-advance or re-zero', async () => {
    const { sub } = await createPendingSub({ tierSlug: 'basic', offerSlug: 'intro3mo' })

    const now = new Date('2026-03-01T00:00:00Z')
    const periodEnd = new Date('2026-04-01T00:00:00Z')

    // First call — fires both writes.
    await extendTierSubscription({
      payload,
      userId,
      tierSlug: 'basic',
      subscriptionId: sub.id,
      newPeriodStart: now,
      newPeriodEnd: periodEnd,
      isIntroCharge: true,
      order: 'renewal',
    })
    const afterFirst = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(afterFirst.introChargesUsed).toBe(1)

    // Simulate mid-period usage; a replay must NOT re-zero.
    const usersColl = payload.db.collections['users']
    await usersColl.updateOne({ _id: new ObjectId(userId) }, { $set: { llmTokensUsed: 42_000 } })

    // Second call with the same newPeriodEnd — CAS blocks both writes.
    await extendTierSubscription({
      payload,
      userId,
      tierSlug: 'basic',
      subscriptionId: sub.id,
      newPeriodStart: now,
      newPeriodEnd: periodEnd,
      isIntroCharge: true,
      order: 'renewal',
    })

    const afterSecond = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(afterSecond.introChargesUsed).toBe(1)

    const userAfter = (await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    })) as any
    expect(userAfter.llmTokensUsed).toBe(42_000)
  })
})

describe('POST /api/subscriptions/bootstrap/tranzilla', () => {
  it('returns 401 when unauthenticated', async () => {
    const route = await import('@/app/api/subscriptions/bootstrap/tranzilla/route')
    const request = new NextRequest('http://localhost:3000/api/subscriptions/bootstrap/tranzilla', {
      method: 'POST',
      body: JSON.stringify({
        tierSlug: 'basic',
        offerSlug: 'default',
        successUrl: 'http://x/success',
        cancelUrl: 'http://x/cancel',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await route.POST(request)
    expect(res.status).toBe(401)
  })

  it('rejects bad tier/offer slugs', async () => {
    const route = await import('@/app/api/subscriptions/bootstrap/tranzilla/route')
    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users', tenant: tenantId } } as any)
    try {
      const request = new NextRequest(
        'http://localhost:3000/api/subscriptions/bootstrap/tranzilla',
        {
          method: 'POST',
          body: JSON.stringify({
            tierSlug: 'nope',
            offerSlug: 'default',
            successUrl: 'http://x/success',
            cancelUrl: 'http://x/cancel',
          }),
          headers: { 'content-type': 'application/json' },
        },
      )
      const res = await route.POST(request)
      expect(res.status).toBe(400)
    } finally {
      authMock.mockRestore()
    }
  })
})

describe('PATCH /api/subscriptions/[id]/cancel', () => {
  it('flips an active sub to cancelled + cancelAtPeriodEnd=true', async () => {
    const route = await import('@/app/api/subscriptions/[id]/cancel/route')
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk1',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const request = new NextRequest(`http://localhost:3000/api/subscriptions/${sub.id}/cancel`, {
        method: 'PATCH',
      })
      const res = await route.PATCH(request, { params: Promise.resolve({ id: sub.id }) })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.cancelAtPeriodEnd).toBe(true)
    } finally {
      authMock.mockRestore()
    }

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.status).toBe('cancelled')
    expect(after.cancelAtPeriodEnd).toBe(true)
    expect(after.cancelledAt).toBeTruthy()
  })

  it('rejects cancels on a sub owned by a different user', async () => {
    const route = await import('@/app/api/subscriptions/[id]/cancel/route')
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk2',
      status: 'active',
    })

    const otherUser = await payload.create({
      collection: 'users',
      data: {
        email: `other-${Date.now()}@test.com`,
        password: 'test-password-123!',
        name: 'Other',
        tenant: tenantId,
      } as any,
      overrideAccess: true,
    })
    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: otherUser.id, collection: 'users' } } as any)
    try {
      const request = new NextRequest(`http://localhost:3000/api/subscriptions/${sub.id}/cancel`, {
        method: 'PATCH',
      })
      const res = await route.PATCH(request, { params: Promise.resolve({ id: sub.id }) })
      expect(res.status).toBe(403)
    } finally {
      authMock.mockRestore()
      await payload.delete({ collection: 'users', id: otherUser.id, overrideAccess: true })
    }
  })

  it('cancels the Tranzila STO before flipping local status when stoId is set', async () => {
    const route = await import('@/app/api/subscriptions/[id]/cancel/route')
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()
    cancelMock.mockResolvedValueOnce({
      httpStatus: 200,
      errorCode: 0,
      message: null,
      body: {},
      rawText: '',
      contentType: 'application/json',
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '487539',
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const request = new NextRequest(`http://localhost:3000/api/subscriptions/${sub.id}/cancel`, {
        method: 'PATCH',
      })
      const res = await route.PATCH(request, { params: Promise.resolve({ id: sub.id }) })
      expect(res.status).toBe(200)
      expect(cancelMock).toHaveBeenCalledTimes(1)
      expect(cancelMock.mock.calls[0]?.[0]).toMatchObject({ stoId: '487539' })
    } finally {
      authMock.mockRestore()
    }

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.status).toBe('cancelled')
    expect(after.cancelAtPeriodEnd).toBe(true)
  })

  it('leaves local status unchanged and returns 502 when Tranzila cancel fails', async () => {
    const route = await import('@/app/api/subscriptions/[id]/cancel/route')
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()
    cancelMock.mockResolvedValueOnce({
      httpStatus: 200,
      errorCode: 10001,
      message: 'standing order not found',
      body: { error_code: 10001, message: 'standing order not found' },
      rawText: '',
      contentType: 'application/json',
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '999999',
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const request = new NextRequest(`http://localhost:3000/api/subscriptions/${sub.id}/cancel`, {
        method: 'PATCH',
      })
      const res = await route.PATCH(request, { params: Promise.resolve({ id: sub.id }) })
      expect(res.status).toBe(502)
      expect(cancelMock).toHaveBeenCalledTimes(1)
    } finally {
      authMock.mockRestore()
    }

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.status).toBe('active')
    expect(after.cancelAtPeriodEnd).toBe(false)
    expect(after.cancelledAt ?? null).toBeNull()
  })

  it('returns 409 for a sub in mid-handoff (stoId sentinel) without calling Tranzila', async () => {
    const route = await import('@/app/api/subscriptions/[id]/cancel/route')
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: `pending-handoff:${new ObjectId().toHexString()}`,
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const request = new NextRequest(`http://localhost:3000/api/subscriptions/${sub.id}/cancel`, {
        method: 'PATCH',
      })
      const res = await route.PATCH(request, { params: Promise.resolve({ id: sub.id }) })
      expect(res.status).toBe(409)
      expect(cancelMock).not.toHaveBeenCalled()
    } finally {
      authMock.mockRestore()
    }

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.status).toBe('active')
  })

  it('soft-cancels a cron-driven Tranzila sub (stoId null) without calling Tranzila', async () => {
    const route = await import('@/app/api/subscriptions/[id]/cancel/route')
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk-cron-only',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      // No stoId → cron owns renewals, nothing to tell Tranzila
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const request = new NextRequest(`http://localhost:3000/api/subscriptions/${sub.id}/cancel`, {
        method: 'PATCH',
      })
      const res = await route.PATCH(request, { params: Promise.resolve({ id: sub.id }) })
      expect(res.status).toBe(200)
      expect(cancelMock).not.toHaveBeenCalled()
    } finally {
      authMock.mockRestore()
    }

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.status).toBe('cancelled')
    expect(after.cancelAtPeriodEnd).toBe(true)
  })
})

describe('Subscriptions beforeChange — admin-driven cancel (Mission 4)', () => {
  it('calls Tranzila cancelStandingOrder when admin flips an active Tranzila sub to cancelled', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()
    cancelMock.mockResolvedValueOnce({
      httpStatus: 200,
      errorCode: 0,
      message: null,
      body: {},
      rawText: '',
      contentType: 'application/json',
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '487800',
    })

    const updated = (await payload.update({
      collection: 'subscriptions',
      id: sub.id,
      data: { status: 'cancelled' } as any,
      overrideAccess: true,
    })) as any
    expect(updated.status).toBe('cancelled')
    expect(cancelMock).toHaveBeenCalledTimes(1)
    expect(cancelMock.mock.calls[0]?.[0]).toMatchObject({ stoId: '487800' })
  })

  it('aborts the admin save when Tranzila returns a non-zero error_code', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()
    cancelMock.mockResolvedValueOnce({
      httpStatus: 200,
      errorCode: 10001,
      message: 'standing order not found',
      body: {},
      rawText: '',
      contentType: 'application/json',
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '999998',
    })

    await expect(
      payload.update({
        collection: 'subscriptions',
        id: sub.id,
        data: { status: 'cancelled' } as any,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Tranzila refused/)

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.status).toBe('active')
  })

  it('skips the Tranzila call when the user-cancel endpoint passed skipStoCancel', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '487801',
    })

    await payload.update({
      collection: 'subscriptions',
      id: sub.id,
      data: { status: 'cancelled' } as any,
      overrideAccess: true,
      context: { skipStoCancel: true },
    })
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('skips the Tranzila call when stoId is null (cron-driven sub)', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk-cron',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    })

    await payload.update({
      collection: 'subscriptions',
      id: sub.id,
      data: { status: 'cancelled' } as any,
      overrideAccess: true,
    })
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('skips the Tranzila call when stoId is a mid-handoff sentinel', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: `pending-handoff:${new ObjectId().toHexString()}`,
    })

    const updated = (await payload.update({
      collection: 'subscriptions',
      id: sub.id,
      data: { status: 'cancelled' } as any,
      overrideAccess: true,
    })) as any
    expect(updated.status).toBe('cancelled')
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('does not fire on unrelated status transitions (pending→expired)', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const cancelMock = v2.cancelStandingOrder as unknown as ReturnType<typeof vi.fn>
    cancelMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'pending',
      stoId: '487802',
    })

    await payload.update({
      collection: 'subscriptions',
      id: sub.id,
      data: { status: 'expired' } as any,
      overrideAccess: true,
    })
    expect(cancelMock).not.toHaveBeenCalled()
  })
})

describe('sweepTranzillaRenewals', () => {
  it('charges a due sub, extends the period, and increments intro counter', async () => {
    const { sweepTranzillaRenewals } =
      await import('@/server/payload/endpoints/cron/tranzilla-renewals')
    const tranzillaLib = await import('@/lib/payment/tranzilla')
    ;(tranzillaLib.chargeTranzillaToken as any).mockReset().mockResolvedValue({
      approved: true,
      responseCode: '000',
      index: `TZIDX-${Date.now()}`,
      confirmationCode: '1234',
      raw: {},
    })

    const originalEnd = new Date(Date.now() + 30 * 60 * 1000) // 30 min in future
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'intro3mo',
      cardToken: 'tk-renew',
      status: 'active',
      currentPeriodEnd: originalEnd,
      cancelAtPeriodEnd: false,
    })

    const result = await sweepTranzillaRenewals(payload)
    expect(result.renewed).toBeGreaterThanOrEqual(1)

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('active')
    expect(new Date(refreshed.currentPeriodEnd).getTime()).toBeGreaterThan(originalEnd.getTime())
    expect(refreshed.introChargesUsed).toBe(1)
  })

  it('increments retry counter on decline and flips to past_due', async () => {
    const { sweepTranzillaRenewals } =
      await import('@/server/payload/endpoints/cron/tranzilla-renewals')
    const tranzillaLib = await import('@/lib/payment/tranzilla')
    ;(tranzillaLib.chargeTranzillaToken as any).mockReset().mockResolvedValue({
      approved: false,
      responseCode: '051',
      index: null,
      confirmationCode: null,
      raw: {},
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk-fail',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 5 * 60 * 1000),
      cancelAtPeriodEnd: false,
    })

    const result = await sweepTranzillaRenewals(payload)
    expect(result.retried).toBeGreaterThanOrEqual(1)

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('past_due')
    expect(refreshed.tranzillaRetryCount).toBe(1)
  })

  it('expires + downgrades the user when retry count hits the ceiling', async () => {
    const { sweepTranzillaRenewals, MAX_RENEWAL_RETRIES } =
      await import('@/server/payload/endpoints/cron/tranzilla-renewals')
    const tranzillaLib = await import('@/lib/payment/tranzilla')
    ;(tranzillaLib.chargeTranzillaToken as any).mockReset().mockResolvedValue({
      approved: false,
      responseCode: '051',
      index: null,
      confirmationCode: null,
      raw: {},
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk-expire',
      status: 'pending',
      cancelAtPeriodEnd: false,
    })

    // Drive promotion through the REAL extendTierSubscription path. This
    // is deliberately NOT a hand-rolled seed via the Mongoose Model: the
    // Model casts writes per the schema, which would mask any type-
    // coercion drift between the real write path (raw driver) and the
    // downgrade predicate (ObjectId filter). This is exactly the hole
    // Kody surfaced on round 4 — the previous test seeded via the Model,
    // so the write stored a correct ObjectId; the real path stored a
    // string and every expiry silently no-op'd.
    await extendTierSubscription({
      payload,
      userId,
      tierSlug: 'basic',
      subscriptionId: sub.id,
      newPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
      newPeriodEnd: new Date(Date.now() + 60 * 1000),
      isIntroCharge: false,
      order: 'bootstrap',
    })
    // One retry short of the ceiling so the next failed charge expires.
    const subsColl = payload.db.collections['subscriptions']
    await subsColl.updateOne(
      { _id: new ObjectId(sub.id) },
      { $set: { tranzillaRetryCount: MAX_RENEWAL_RETRIES - 1, status: 'past_due' } },
    )

    const result = await sweepTranzillaRenewals(payload)
    expect(result.expired).toBeGreaterThanOrEqual(1)

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('expired')

    const user = (await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    })) as any
    expect(user.currentTier).toBe('free')
    expect(user.tierGrantSource).toBeFalsy()
    expect(user.tierGrantSubscriptionId).toBeFalsy()
  })

  it('does NOT downgrade users whose tier was granted via legacy_one_time or manual', async () => {
    const { sweepTranzillaRenewals } =
      await import('@/server/payload/endpoints/cron/tranzilla-renewals')

    // Legacy tier buyer who then also bootstrapped (and cancelled) a sub.
    // Their currentTier stayed basic throughout and tierGrantSource was
    // never flipped to 'subscription' because no charge ever landed.
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk-legacy',
      status: 'cancelled',
      currentPeriodEnd: new Date(Date.now() - 60 * 1000),
      cancelAtPeriodEnd: true,
    })
    const usersColl = payload.db.collections['users']
    await usersColl.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { currentTier: 'basic', tierGrantSource: 'legacy_one_time' } },
    )

    await sweepTranzillaRenewals(payload)

    const user = (await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    })) as any
    // The sub expired but the legacy tier survived.
    expect(user.currentTier).toBe('basic')
    expect(user.tierGrantSource).toBe('legacy_one_time')

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('expired')
  })

  it('expires soft-cancelled subs whose period has passed', async () => {
    const { sweepTranzillaRenewals } =
      await import('@/server/payload/endpoints/cron/tranzilla-renewals')

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk-soft',
      status: 'pending',
      cancelAtPeriodEnd: false,
    })

    // Drive promotion through the REAL path (not a hand-rolled seed) so the
    // tierGrantSubscriptionId value stored on the User is what the raw
    // driver actually writes. Then flip the sub into the soft-cancelled
    // state with an expired period.
    const periodEnd = new Date(Date.now() - 60 * 1000)
    await extendTierSubscription({
      payload,
      userId,
      tierSlug: 'basic',
      subscriptionId: sub.id,
      newPeriodStart: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      newPeriodEnd: periodEnd,
      isIntroCharge: false,
      order: 'bootstrap',
    })
    const subsColl = payload.db.collections['subscriptions']
    await subsColl.updateOne(
      { _id: new ObjectId(sub.id) },
      { $set: { status: 'cancelled', cancelAtPeriodEnd: true } },
    )

    const result = await sweepTranzillaRenewals(payload)
    expect(result.softCancelExpired).toBeGreaterThanOrEqual(1)

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('expired')

    const user = (await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    })) as any
    expect(user.currentTier).toBe('free')
  })
})

describe('Tranzila webhook — STO renewal correlation (Mission 1)', () => {
  async function postToWebhook(body: Record<string, string>) {
    const route = await import('@/app/api/webhooks/tranzilla/route')
    const request = new NextRequest('http://localhost:3000/api/webhooks/tranzilla', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
    return route.POST(request)
  }

  it('advances the sub and records a renewal Tx when sto_id correlates', async () => {
    const originalEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: originalEnd,
      cancelAtPeriodEnd: false,
      stoId: '487700',
    })

    const res = await postToWebhook({
      index: `tz-renewal-${new ObjectId().toHexString()}`,
      Response: '000',
      sum: '59.00',
      currency: '1',
      ConfirmationCode: '9988',
      TranzilaTK: 'tk-sto-renew',
      sto_id: '487700',
    })
    expect(res.status).toBe(200)

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('active')
    expect(new Date(refreshed.currentPeriodEnd).getTime()).toBeGreaterThan(originalEnd.getTime())

    const txs = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ subscription: { equals: sub.id } }, { isRenewal: { equals: true } }],
      },
      limit: 10,
      overrideAccess: true,
    })
    expect(txs.docs.length).toBe(1)
    const renewalTx = txs.docs[0] as any
    expect(renewalTx.status).toBe('succeeded')
    expect(renewalTx.amount).toBe(5900)
  })

  it('increments introChargesUsed when the sub is still on an intro offer', async () => {
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'intro3mo',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '487701',
    })

    await postToWebhook({
      index: `tz-renewal-${new ObjectId().toHexString()}`,
      Response: '000',
      sum: '33.00',
      currency: '1',
      TranzilaTK: 'tk-intro',
      sto_id: '487701',
    })

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.introChargesUsed).toBe(1)
  })

  it('flips sub to past_due and records a failure Tx on decline', async () => {
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '487702',
    })

    const res = await postToWebhook({
      index: `tz-renewal-${new ObjectId().toHexString()}`,
      Response: '051', // insufficient funds
      sum: '59.00',
      currency: '1',
      TranzilaTK: 'tk-decline',
      sto_id: '487702',
    })
    expect(res.status).toBe(200)

    const refreshed = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(refreshed.status).toBe('past_due')
    expect(refreshed.tranzillaRetryCount).toBe(1)

    const txs = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ subscription: { equals: sub.id } }, { isRenewal: { equals: true } }],
      },
      limit: 10,
      overrideAccess: true,
    })
    expect(txs.docs.length).toBe(1)
    expect((txs.docs[0] as any).status).toBe('failed')
  })

  it('acks and logs unassociated when sto_id matches no Subscriptions row', async () => {
    const res = await postToWebhook({
      index: `tz-orphan-${new ObjectId().toHexString()}`,
      Response: '000',
      sum: '59.00',
      currency: '1',
      sto_id: '999999', // no sub has this
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.unassociated).toBe(true)
  })

  it('is idempotent on replay — second POST with the same index no-ops', async () => {
    const originalEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: originalEnd,
      cancelAtPeriodEnd: false,
      stoId: '487703',
    })

    const sharedIndex = `tz-replay-${new ObjectId().toHexString()}`
    await postToWebhook({
      index: sharedIndex,
      Response: '000',
      sum: '59.00',
      currency: '1',
      sto_id: '487703',
    })
    const afterFirst = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    const periodEndAfterFirst = new Date(afterFirst.currentPeriodEnd).getTime()

    const res = await postToWebhook({
      index: sharedIndex,
      Response: '000',
      sum: '59.00',
      currency: '1',
      sto_id: '487703',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.deduped).toBe(true)

    const afterSecond = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(new Date(afterSecond.currentPeriodEnd).getTime()).toBe(periodEndAfterFirst)

    const txs = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ subscription: { equals: sub.id } }, { isRenewal: { equals: true } }],
      },
      limit: 10,
      overrideAccess: true,
    })
    expect(txs.docs.length).toBe(1)
  })
})

describe('PATCH /api/subscriptions/[id]/change-tier (Mission 2 — upgrade)', () => {
  async function patchChangeTier(subId: string, tierSlug: string) {
    const route = await import('@/app/api/subscriptions/[id]/change-tier/route')
    const request = new NextRequest(
      `http://localhost:3000/api/subscriptions/${subId}/change-tier`,
      {
        method: 'PATCH',
        body: JSON.stringify({ tierSlug }),
        headers: { 'content-type': 'application/json' },
      },
    )
    return route.PATCH(request, { params: Promise.resolve({ id: subId }) })
  }

  it('swaps items on Tranzila + flips tier + updates sub on a valid upgrade', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const swapMock = v2.swapStandingOrderItems as unknown as ReturnType<typeof vi.fn>
    swapMock.mockClear()
    swapMock.mockResolvedValueOnce({
      httpStatus: 200,
      errorCode: 0,
      message: 'Success',
      body: {},
      rawText: '',
      contentType: 'application/json',
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '500001',
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'advanced')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.success).toBe(true)
      expect(body.tierSlug).toBe('advanced')
      expect(body.regularPriceIls).toBe(119)
    } finally {
      authMock.mockRestore()
    }

    expect(swapMock).toHaveBeenCalledTimes(1)
    expect(swapMock.mock.calls[0]?.[0]).toMatchObject({
      stoId: '500001',
      unitPriceIls: 119,
      itemName: 'AGuy Subscription — advanced',
    })

    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.tierSlug).toBe('advanced')
    expect(after.regularPriceIls).toBe(119)

    const user = (await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    })) as any
    expect(user.currentTier).toBe('advanced')
  })

  it('rejects a downgrade (not yet supported)', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const swapMock = v2.swapStandingOrderItems as unknown as ReturnType<typeof vi.fn>
    swapMock.mockClear()

    const { sub } = await createPendingSub({
      tierSlug: 'advanced',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '500002',
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'basic')
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toMatch(/downgrade/i)
    } finally {
      authMock.mockRestore()
    }
    expect(swapMock).not.toHaveBeenCalled()
  })

  it('rejects same-tier change', async () => {
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '500003',
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'basic')
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toMatch(/already on tier/i)
    } finally {
      authMock.mockRestore()
    }
  })

  it('rejects when the sub has no stoId (cron-driven, no STO to update)', async () => {
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      cardToken: 'tk',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      // No stoId
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'advanced')
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toMatch(/standing-order id/)
    } finally {
      authMock.mockRestore()
    }
  })

  it('returns 409 on mid-handoff sentinel stoId', async () => {
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: `pending-handoff:${new ObjectId().toHexString()}`,
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'advanced')
      expect(res.status).toBe(409)
      const body = (await res.json()) as any
      expect(body.error).toMatch(/handoff/i)
    } finally {
      authMock.mockRestore()
    }
  })

  it('returns 502 when Tranzila refuses the swap', async () => {
    const v2 = await import('@/lib/payment/tranzila-v2-client')
    const swapMock = v2.swapStandingOrderItems as unknown as ReturnType<typeof vi.fn>
    swapMock.mockClear()
    swapMock.mockResolvedValueOnce({
      httpStatus: 200,
      errorCode: 20004,
      message: 'Json does not match validation schema',
      body: {},
      rawText: '',
      contentType: 'application/json',
    })

    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      stoId: '500004',
    })

    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: userId, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'advanced')
      expect(res.status).toBe(502)
    } finally {
      authMock.mockRestore()
    }

    // Local sub stays untouched when Tranzila refuses.
    const after = (await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })) as any
    expect(after.tierSlug).toBe('basic')
    expect(after.regularPriceIls).toBe(59)
  })

  it('rejects when the user does not own the sub', async () => {
    const { sub } = await createPendingSub({
      tierSlug: 'basic',
      offerSlug: 'default',
      status: 'active',
      stoId: '500005',
    })

    const otherUser = await payload.create({
      collection: 'users',
      data: {
        email: `other-${Date.now()}@test.com`,
        password: 'test-password-123!',
        name: 'Other',
        tenant: tenantId,
      } as any,
      overrideAccess: true,
    })
    const authMock = vi
      .spyOn(payload as any, 'auth')
      .mockResolvedValue({ user: { id: otherUser.id, collection: 'users' } } as any)
    try {
      const res = await patchChangeTier(sub.id, 'advanced')
      expect(res.status).toBe(403)
    } finally {
      authMock.mockRestore()
      await payload.delete({ collection: 'users', id: otherUser.id, overrideAccess: true })
    }
  })
})
