/**
 * Integration tests: Enrollments Expiry Sweeper
 *
 * Guards the sweeper's write predicate — it must ONLY flip
 * status='active' + past expiresAt to 'expired', and must leave every
 * other combination untouched. The sweeper writes are unattended and
 * security-sensitive, so a future refactor that widens the filter
 * (e.g. dropping the status check) needs to fail loudly here.
 *
 * @fileType integration-test
 * @domain entitlements
 * @ai-summary Tests sweepExpiredEnrollments against every status × expiresAt permutation
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'
import { sweepExpiredEnrollments } from '@/server/payload/endpoints/cron/enrollments-expiry'

let payload: Payload
let originalDatabaseUrl: string | undefined
let tenantId: string
let categoryId: string
let courseId: string

// Times relative to the sweep run.
const HOUR_MS = 60 * 60 * 1000
const past = () => new Date(Date.now() - HOUR_MS).toISOString()
const future = () => new Date(Date.now() + HOUR_MS).toISOString()

interface Scenario {
  key: string
  status: 'active' | 'inactive' | 'suspended' | 'cancelled' | 'expired'
  expiresAt: string | null | undefined
  expectedStatus: 'active' | 'inactive' | 'suspended' | 'cancelled' | 'expired'
  shouldFlip: boolean
}

// Every combination we care about. Only one row should flip.
const SCENARIOS: Scenario[] = [
  {
    key: 'active-past',
    status: 'active',
    expiresAt: past(),
    expectedStatus: 'expired',
    shouldFlip: true,
  },
  {
    key: 'active-future',
    status: 'active',
    expiresAt: future(),
    expectedStatus: 'active',
    shouldFlip: false,
  },
  {
    key: 'active-null',
    status: 'active',
    expiresAt: null,
    expectedStatus: 'active',
    shouldFlip: false,
  },
  {
    key: 'active-missing',
    status: 'active',
    expiresAt: undefined,
    expectedStatus: 'active',
    shouldFlip: false,
  },
  {
    key: 'cancelled-past',
    status: 'cancelled',
    expiresAt: past(),
    expectedStatus: 'cancelled',
    shouldFlip: false,
  },
  {
    key: 'expired-past',
    status: 'expired',
    expiresAt: past(),
    expectedStatus: 'expired',
    shouldFlip: false,
  },
  {
    key: 'inactive-past',
    status: 'inactive',
    expiresAt: past(),
    expectedStatus: 'inactive',
    shouldFlip: false,
  },
  {
    key: 'suspended-past',
    status: 'suspended',
    expiresAt: past(),
    expectedStatus: 'suspended',
    shouldFlip: false,
  },
]

const seededEnrollmentIds = new Map<string, string>()
const seededOriginalUpdatedAt = new Map<string, string>()

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL
  // @ts-expect-error: TypeScript doesn't allow delete on process.env
  delete process.env.DATABASE_URL

  const mongoUri = await startMongoContainer()
  process.env.DATABASE_URL = mongoUri

  const config = await import('@payload-config')
  payload = await getPayload({ config: config.default })

  const stamp = Date.now()

  const tenant = await payload.create({
    collection: 'tenants',
    data: { name: `expiry-test-${stamp}`, slug: `expiry-test-${stamp}` } as any,
    overrideAccess: true,
  })
  tenantId = tenant.id

  const category = await payload.create({
    collection: 'categories',
    data: {
      title: 'Expiry Test Category',
      slug: `expiry-cat-${stamp}`,
      locale: 'he',
    } as any,
    overrideAccess: true,
  })
  categoryId = category.id

  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'X1',
      title: 'Expiry Test Course',
      categories: [categoryId],
      tenant: tenantId,
    } as any,
    overrideAccess: true,
  })
  courseId = course.id

  // One user per scenario — the {user, course} unique index requires this.
  for (const scenario of SCENARIOS) {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `expiry-${scenario.key}-${stamp}@test.local`,
        password: 'test123456',
        name: `Expiry ${scenario.key}`,
      } as any,
      overrideAccess: true,
    })

    const data: Record<string, unknown> = {
      user: user.id,
      course: courseId,
      status: scenario.status,
      grantMethod: 'admin',
      source: 'dashboard',
    }
    // Only set expiresAt when the scenario wants it present (past/future/null).
    // Explicitly passing `undefined` would omit the field just as it would for
    // a real "lifetime" enrollment written without expiry.
    if (scenario.expiresAt !== undefined) {
      data.expiresAt = scenario.expiresAt
    }

    const enrollment = await payload.create({
      collection: 'enrollments',
      data: data as any,
      overrideAccess: true,
    })
    seededEnrollmentIds.set(scenario.key, enrollment.id)
    seededOriginalUpdatedAt.set(scenario.key, (enrollment as any).updatedAt)
  }

  // Ensure a measurable gap so the updatedAt refresh assertion is unambiguous.
  await new Promise((resolve) => setTimeout(resolve, 50))
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

describe('sweepExpiredEnrollments', () => {
  it('flips only active+past-expiresAt rows and leaves every other combination untouched', async () => {
    const result = await sweepExpiredEnrollments(payload)

    // Exactly one seeded scenario should flip.
    expect(result.matchedCount).toBe(1)
    expect(result.modifiedCount).toBe(1)

    for (const scenario of SCENARIOS) {
      const id = seededEnrollmentIds.get(scenario.key)!
      const doc = await payload.findByID({
        collection: 'enrollments',
        id,
        depth: 0,
        overrideAccess: true,
      })
      expect(doc.status, `scenario=${scenario.key}`).toBe(scenario.expectedStatus)
    }
  })

  it('refreshes updatedAt on the flipped row', async () => {
    const id = seededEnrollmentIds.get('active-past')!
    const before = seededOriginalUpdatedAt.get('active-past')!

    const doc = await payload.findByID({
      collection: 'enrollments',
      id,
      depth: 0,
      overrideAccess: true,
    })

    expect(new Date((doc as any).updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime())
  })

  it('leaves updatedAt untouched on rows the sweep did not flip', async () => {
    const id = seededEnrollmentIds.get('active-future')!
    const before = seededOriginalUpdatedAt.get('active-future')!

    const doc = await payload.findByID({
      collection: 'enrollments',
      id,
      depth: 0,
      overrideAccess: true,
    })

    expect((doc as any).updatedAt).toBe(before)
  })

  it('is a no-op on a second run (nothing left to flip)', async () => {
    const result = await sweepExpiredEnrollments(payload)
    expect(result.matchedCount).toBe(0)
    expect(result.modifiedCount).toBe(0)
  })
})
