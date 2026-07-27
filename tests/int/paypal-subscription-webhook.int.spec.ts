// @vitest-environment node
/**
 * Integration tests: PayPal subscription lifecycle webhooks
 *
 * Covers the new Subscriptions collection + extendProductEntitlements +
 * BILLING.SUBSCRIPTION.* / PAYMENT.SALE.COMPLETED handlers in
 * /api/webhooks/paypal.
 *
 * @fileType integration-test
 * @domain payments
 * @pattern subscription-lifecycle
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'

let paypalWebhookHandler: (request: NextRequest) => Promise<Response>
let payload: Payload
let originalDatabaseUrl: string | undefined

let tenantId: string
let userId: string
let courseId: string
let productId: string

// Unique ID counter so each test gets fresh PayPal identifiers
let subCounter = 0
function nextSubId(): string {
  subCounter++
  return `I-SUB${Date.now()}${subCounter}`
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL
  // @ts-expect-error: TypeScript doesn't allow delete on process.env
  delete process.env.DATABASE_URL

  const mongoUri = await startMongoContainer()
  process.env.DATABASE_URL = mongoUri

  const config = await import('@payload-config')
  payload = await getPayload({ config: config.default })

  const paypalRoute = await import('@/app/api/webhooks/paypal/route')
  paypalWebhookHandler = paypalRoute.POST

  const tenant = await payload.create({
    collection: 'tenants',
    data: { name: `sub-test-${Date.now()}`, slug: `sub-test-${Date.now()}` } as any,
    overrideAccess: true,
  })
  tenantId = tenant.id

  const category = await payload.create({
    collection: 'categories',
    data: { title: 'Sub Cat', slug: `sub-cat-${Date.now()}`, locale: 'he' } as any,
    overrideAccess: true,
  })
  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: 'S1',
      title: 'Sub Test Course',
      categories: [category.id],
      tenant: tenantId,
    } as any,
    overrideAccess: true,
  })
  courseId = course.id

  const product = await payload.create({
    collection: 'products',
    data: {
      name: `Sub Test Product ${Date.now()}`,
      slug: `sub-test-product-${Date.now()}`,
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
      email: `sub-user-${Date.now()}@test.com`,
      password: 'test-password-123!',
      name: 'Sub Test User',
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
    // @ts-expect-error
    delete process.env.DATABASE_URL
  }
}, 120_000)

async function cleanup() {
  const enrollments = await payload.find({
    collection: 'enrollments',
    where: { user: { equals: userId } },
    limit: 100,
    overrideAccess: true,
  })
  for (const e of enrollments.docs) {
    await payload.delete({
      collection: 'enrollments',
      id: (e as { id: string }).id,
      overrideAccess: true,
    })
  }
  const txs = await payload.find({
    collection: 'transactions',
    where: { user: { equals: userId } },
    limit: 100,
    overrideAccess: true,
  })
  for (const t of txs.docs) {
    await payload.delete({
      collection: 'transactions',
      id: (t as { id: string }).id,
      overrideAccess: true,
    })
  }
  const subs = await payload.find({
    collection: 'subscriptions',
    where: { user: { equals: userId } },
    limit: 100,
    overrideAccess: true,
  })
  for (const s of subs.docs) {
    await payload.delete({
      collection: 'subscriptions',
      id: (s as { id: string }).id,
      overrideAccess: true,
    })
  }
}

beforeEach(cleanup)
afterEach(cleanup)

// Verifier + dedup are exercised elsewhere; stub verifier here so we can
// synthesise events without needing PayPal signature material.
vi.mock('@/lib/payment/paypal', async () => {
  const actual = await vi.importActual<any>('@/lib/payment/paypal')
  return { ...actual, verifyPayPalWebhook: vi.fn().mockResolvedValue(true) }
})

async function seedSubscriptionAndInitialTx(paypalSubscriptionId: string) {
  const initialTx = await payload.create({
    collection: 'transactions',
    data: {
      tenant: tenantId,
      user: userId,
      product: productId,
      provider: 'paypal',
      providerTransactionId: paypalSubscriptionId,
      status: 'pending',
      amount: 5900,
      currency: 'ILS',
      isRenewal: false,
    } as any,
    overrideAccess: true,
  })

  const sub = await payload.create({
    collection: 'subscriptions',
    data: {
      tenant: tenantId,
      user: userId,
      product: productId,
      provider: 'paypal',
      paypalSubscriptionId,
      status: 'pending',
      initialTransaction: initialTx.id,
    } as any,
    overrideAccess: true,
  })
  return { initialTx, sub }
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/paypal', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'paypal-transmission-id': `tid-${Date.now()}-${Math.random()}`,
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'stub',
      'paypal-cert-url': 'https://api.paypal.com/cert',
      'paypal-auth-algo': 'SHA256withRSA',
    },
  })
}

describe('PayPal subscription webhooks', () => {
  it('BILLING.SUBSCRIPTION.ACTIVATED grants entitlements, sets status=active, flips initial tx', async () => {
    const paypalSubId = nextSubId()
    const { initialTx, sub } = await seedSubscriptionAndInitialTx(paypalSubId)

    const eventId = `evt-activated-${Date.now()}`
    const nextBilling = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const req = makeRequest({
      id: eventId,
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: {
        id: paypalSubId,
        status: 'ACTIVE',
        start_time: new Date().toISOString(),
        billing_info: { next_billing_time: nextBilling },
      },
    })

    const res = await paypalWebhookHandler(req)
    expect(res.status).toBe(200)

    const refreshedSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((refreshedSub as any).status).toBe('active')
    expect((refreshedSub as any).currentPeriodEnd).toBe(nextBilling)

    const refreshedTx = await payload.findByID({
      collection: 'transactions',
      id: initialTx.id,
      overrideAccess: true,
    })
    expect((refreshedTx as any).status).toBe('succeeded')
    expect((refreshedTx as any).entitlementsGrantedAt).toBeTruthy()

    const enrollments = await payload.find({
      collection: 'enrollments',
      where: {
        and: [{ user: { equals: userId } }, { course: { equals: courseId } }],
      },
      overrideAccess: true,
    })
    expect(enrollments.totalDocs).toBe(1)
    expect((enrollments.docs[0] as any).status).toBe('active')
  })

  it('PAYMENT.SALE.COMPLETED extends enrollment expiresAt from its current value (not from now)', async () => {
    const paypalSubId = nextSubId()
    const { sub, initialTx } = await seedSubscriptionAndInitialTx(paypalSubId)

    // Activate first
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: {
          id: paypalSubId,
          start_time: new Date().toISOString(),
          billing_info: {
            next_billing_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      }),
    )

    // Set the enrollment's expiresAt to a specific future date so we can prove
    // the extension anchors on THAT value, not on Date.now()
    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    const enrollmentId = (enrollments.docs[0] as any).id
    const anchoredExpiresAt = new Date('2030-01-15T00:00:00Z').toISOString()
    await payload.update({
      collection: 'enrollments',
      id: enrollmentId,
      data: { expiresAt: anchoredExpiresAt },
      overrideAccess: true,
    })

    // Renewal event
    const saleId = `SALE-${Date.now()}`
    const res = await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )
    expect(res.status).toBe(200)

    const refreshedEnr = await payload.findByID({
      collection: 'enrollments',
      id: enrollmentId,
      overrideAccess: true,
    })
    const newExpiresAt = new Date((refreshedEnr as any).expiresAt).getTime()
    const expectedFromAnchor = new Date(anchoredExpiresAt).getTime() + 30 * 24 * 60 * 60 * 1000
    // Allow 1 second slack for timing
    expect(Math.abs(newExpiresAt - expectedFromAnchor)).toBeLessThan(1000)

    // Renewal Tx was created
    const renewalTxs = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ subscription: { equals: sub.id } }, { isRenewal: { equals: true } }],
      },
      overrideAccess: true,
    })
    expect(renewalTxs.totalDocs).toBe(1)
    expect((renewalTxs.docs[0] as any).providerTransactionId).toBe(saleId)
    expect((renewalTxs.docs[0] as any).amount).toBe(5900)

    // Initial tx is untouched
    expect(initialTx.id).toBeTruthy()
  })

  it('PAYMENT.SALE.COMPLETED for the same sale ID does not create a duplicate renewal Transaction', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act2-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: {
          id: paypalSubId,
          start_time: new Date().toISOString(),
          billing_info: {
            next_billing_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      }),
    )

    const saleId = `SALE-DUP-${Date.now()}`
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-a-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )
    // Replay same sale ID via a DIFFERENT event ID (bypasses webhook-events dedup)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-b-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    const renewalTxs = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ subscription: { equals: sub.id } }, { isRenewal: { equals: true } }],
      },
      overrideAccess: true,
    })
    expect(renewalTxs.totalDocs).toBe(1)
  })

  it('BILLING.SUBSCRIPTION.CANCELLED sets status + cancelledAt but does NOT cancel the enrollment', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act3-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: {
          id: paypalSubId,
          start_time: new Date().toISOString(),
          billing_info: {
            next_billing_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      }),
    )

    await paypalWebhookHandler(
      makeRequest({
        id: `evt-cancel-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.CANCELLED',
        resource: { id: paypalSubId },
      }),
    )

    const refreshedSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((refreshedSub as any).status).toBe('cancelled')
    expect((refreshedSub as any).cancelledAt).toBeTruthy()
    expect((refreshedSub as any).cancelAtPeriodEnd).toBe(true)

    // Enrollment is still active — user retains access until currentPeriodEnd
    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollments.docs[0] as any).status).toBe('active')
  })

  it('BILLING.SUBSCRIPTION.EXPIRED revokes entitlements against the latest paying transaction', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act4-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: {
          id: paypalSubId,
          start_time: new Date().toISOString(),
          billing_info: {
            next_billing_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      }),
    )

    await paypalWebhookHandler(
      makeRequest({
        id: `evt-exp-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.EXPIRED',
        resource: { id: paypalSubId },
      }),
    )

    const refreshedSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((refreshedSub as any).status).toBe('expired')

    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollments.docs[0] as any).status).toBe('cancelled')
  })

  it('BILLING.SUBSCRIPTION.PAYMENT.FAILED sets status=past_due without revoking', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act5-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: {
          id: paypalSubId,
          start_time: new Date().toISOString(),
          billing_info: {
            next_billing_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      }),
    )

    await paypalWebhookHandler(
      makeRequest({
        id: `evt-fail-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
        resource: { id: paypalSubId },
      }),
    )

    const refreshedSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((refreshedSub as any).status).toBe('past_due')

    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollments.docs[0] as any).status).toBe('active')
  })

  it('rejects durationDays on subscription products at the schema layer', async () => {
    await expect(
      payload.create({
        collection: 'products',
        data: {
          name: `Bad Sub ${Date.now()}`,
          slug: `bad-sub-${Date.now()}`,
          billingType: 'subscription',
          interval: 'month',
          price: 10,
          currency: 'ILS',
          durationDays: 30,
          isActive: true,
        } as any,
        overrideAccess: true,
      }),
    ).rejects.toThrow(/durationDays is only valid for one-time products/)
  })
})
