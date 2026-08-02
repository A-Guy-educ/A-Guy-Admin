/**
 * Integration test: renewal against a sweeper-expired enrollment
 *
 * The expiry sweeper flips status='active' rows past expiresAt to 'expired'.
 * Before this test, the CAS in extendEnrollment hard-required status='active',
 * so a late-delivered PAYMENT.SALE.COMPLETED (PayPal retry, past_due recovery)
 * arriving after the sweep would fail all 5 CAS retries and 500 the webhook —
 * the user paid but never regained access.
 *
 * This test seeds the exact post-sweep state (status='expired', expiresAt in
 * the past, prior paymentId) and calls the public renewal entry point.
 * It should reactivate the enrollment, extend expiresAt, and rotate paymentId.
 *
 * @fileType integration-test
 * @domain entitlements
 * @ai-summary Guards the CAS filter widening in extendEnrollment
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { extendProductEntitlements } from '@/lib/payment/grant-entitlements'
import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'

let payload: Payload
let originalDatabaseUrl: string | undefined
let tenantId: string
let categoryId: string
let courseId: string
let productId: string
let userId: string

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
    data: { name: `extend-test-${stamp}`, slug: `extend-test-${stamp}` } as any,
    overrideAccess: true,
  })
  tenantId = tenant.id

  const category = await payload.create({
    collection: 'categories',
    data: { title: 'Extend Cat', slug: `extend-cat-${stamp}`, locale: 'he' } as any,
    overrideAccess: true,
  })
  categoryId = category.id

  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'E1',
      title: `Extend Test Course ${stamp}`,
      categories: [categoryId],
      tenant: tenantId,
    } as any,
    overrideAccess: true,
  })
  courseId = course.id

  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Extend Test Product ${stamp}`,
      slug: `extend-test-product-${stamp}`,
      billingType: 'subscription',
      interval: 'month',
      price: 59,
      currency: 'ILS',
      contents: [{ blockType: 'courseBlock', course: courseId }],
      isActive: true,
      tenant: tenantId,
    } as any,
    overrideAccess: true,
  })
  productId = product.id

  const user = await payload.create({
    collection: 'users',
    data: {
      email: `extend-user-${stamp}@test.local`,
      password: 'test-password-123!',
      name: 'Extend Test User',
    } as any,
    overrideAccess: true,
  })
  userId = user.id
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

describe('extendProductEntitlements against a sweeper-expired enrollment', () => {
  it('reactivates an expired enrollment, extends expiresAt, rotates paymentId', async () => {
    const priorExpiresAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const priorPaymentId = 'PRIOR-SALE-1'

    const seeded = await payload.create({
      collection: 'enrollments',
      data: {
        user: userId,
        course: courseId,
        status: 'expired',
        grantMethod: 'payment',
        source: 'api',
        expiresAt: priorExpiresAt,
        metadata: { paymentId: priorPaymentId },
      } as any,
      overrideAccess: true,
    })

    const newPaymentId = 'RENEWAL-SALE-1'
    const result = await extendProductEntitlements(userId, productId, newPaymentId, 1)

    // Anchor is max(current expiresAt, now). Since prior is in the past,
    // anchor is now; extension is +1 calendar month from now.
    const expectedFloorMs = Date.now() // extension must be past this
    expect(result.maxEnrollmentEndMs).toBeGreaterThan(expectedFloorMs)

    const refreshed = await payload.findByID({
      collection: 'enrollments',
      id: seeded.id,
      overrideAccess: true,
    })

    expect((refreshed as any).status).toBe('active')
    expect(new Date((refreshed as any).expiresAt).getTime()).toBeGreaterThan(expectedFloorMs)
    expect((refreshed as any).metadata?.paymentId).toBe(newPaymentId)
    expect((refreshed as any).cancelledAt).toBeFalsy()
  })
})
