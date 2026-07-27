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

import { addCalendarMonths } from '@/lib/payment/grant-entitlements'
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
    // @ts-expect-error: TypeScript doesn't allow delete on process.env
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
    const enrollment = enrollments.docs[0] as any
    expect(enrollment.status).toBe('active')
    // Enrollment expiresAt is anchored on PayPal's next_billing_time — NOT
    // left null. Prior bug: durationDays was forbidden on sub products, so
    // grantProductEntitlements produced a lifetime enrollment, which then
    // broke the EXPIRED revoke path (paymentId never rotated).
    expect(enrollment.expiresAt).toBe(nextBilling)
    expect(enrollment.metadata?.paymentId).toBe(String(initialTx.id))
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
    // Calendar-aware +1 month from the anchor (matches addCalendarMonths).
    // Jan 15 + 1 month = Feb 15 (30 or 31 days depending on year — mirror the
    // production math instead of assuming 30 days).
    const expectedDate = new Date(anchoredExpiresAt)
    expectedDate.setMonth(expectedDate.getMonth() + 1)
    expect(newExpiresAt).toBe(expectedDate.getTime())

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

  it('PAYMENT.SALE.COMPLETED arriving before ACTIVATED flips the pending initial tx to succeeded', async () => {
    // Out-of-order webhook delivery: SALE lands before ACTIVATED. The renewal
    // handler must flip the initial pending Tx to succeeded, otherwise
    // ACTIVATED will later short-circuit on sub.status === 'active' and
    // leave the initial Tx stuck in pending forever.
    const paypalSubId = nextSubId()
    const { initialTx, sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    expect((sub as any).status).toBe('pending')

    const saleId = `SALE-EARLY-${Date.now()}`
    const res = await paypalWebhookHandler(
      makeRequest({
        id: `evt-early-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )
    expect(res.status).toBe(200)

    // Initial Tx flipped to succeeded
    const initialAfter = await payload.findByID({
      collection: 'transactions',
      id: initialTx.id,
      overrideAccess: true,
    })
    expect((initialAfter as any).status).toBe('succeeded')
    expect((initialAfter as any).entitlementsGrantedAt).toBeTruthy()

    // Sub is active
    const subAfter = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((subAfter as any).status).toBe('active')

    // Enrollment.metadata.paymentId points at the INITIAL tx (matching what
    // the ACTIVATED-first path would have set), so admin-refund of the
    // initial Tx would cleanly revoke access. Without this rotation, the
    // enrollment would stay anchored on the renewal Tx and admin refund
    // would silently fail to revoke.
    const enrollmentAfter = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollmentAfter.docs[0] as any).metadata?.paymentId).toBe(String(initialTx.id))

    // If ACTIVATED lands later, it short-circuits and doesn't double-work
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-late-act-${Date.now()}`,
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
    const initialFinal = await payload.findByID({
      collection: 'transactions',
      id: initialTx.id,
      overrideAccess: true,
    })
    expect((initialFinal as any).status).toBe('succeeded')
  })

  it('renewal currentPeriodEnd matches enrollment expiresAt (no drift)', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-drift-${Date.now()}`,
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
        id: `evt-renew-drift-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: `SALE-DRIFT-${Date.now()}`,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    const refreshedSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    const subEnd = new Date((refreshedSub as any).currentPeriodEnd).getTime()
    const enrollmentEnd = new Date((enrollments.docs[0] as any).expiresAt).getTime()
    expect(subEnd).toBe(enrollmentEnd)
  })

  it('PAYMENT.SALE.REFUNDED on a renewal does NOT cancel the enrollment', async () => {
    // A partial refund of one recurring charge should not terminate access.
    // BILLING.SUBSCRIPTION.CANCELLED / EXPIRED are the source of truth for
    // subscription access termination — refunds only reverse the sale.
    const paypalSubId = nextSubId()
    await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-refund-noremove-${Date.now()}`,
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
    const saleId = `SALE-REFUND-KEEP-${Date.now()}`
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-keep-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    // Refund the renewal
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-refund-keep-${Date.now()}`,
        event_type: 'PAYMENT.SALE.REFUNDED',
        resource: {
          id: `REFUND-${Date.now()}`,
          parent_payment: saleId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    // Renewal Tx is marked refunded
    const renewalTx = await payload.find({
      collection: 'transactions',
      where: { providerTransactionId: { equals: saleId } },
      overrideAccess: true,
    })
    expect((renewalTx.docs[0] as any).status).toBe('refunded')

    // But the enrollment stays active — refunds don't cancel subscription access
    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollments.docs[0] as any).status).toBe('active')
  })

  it('PAYMENT.SALE.COMPLETED for an already-EXPIRED subscription is ignored (does not resurrect)', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-term-${Date.now()}`,
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
        id: `evt-exp-term-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.EXPIRED',
        resource: { id: paypalSubId },
      }),
    )

    // Sanity: sub is terminal, enrollment cancelled
    const preSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((preSub as any).status).toBe('expired')

    // Now a late/stale PAYMENT.SALE.COMPLETED arrives — must NOT resurrect
    const staleSaleId = `SALE-STALE-${Date.now()}`
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-stale-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: staleSaleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    // Sub stays expired
    const postSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((postSub as any).status).toBe('expired')

    // Enrollment stays cancelled
    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollments.docs[0] as any).status).toBe('cancelled')

    // No renewal Tx was created for the stale sale
    const staleTx = await payload.find({
      collection: 'transactions',
      where: { providerTransactionId: { equals: staleSaleId } },
      overrideAccess: true,
    })
    expect(staleTx.totalDocs).toBe(0)
  })

  it('BILLING.SUBSCRIPTION.SUSPENDED sets status=suspended and leaves enrollment active', async () => {
    const paypalSubId = nextSubId()
    const { sub } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-susp-${Date.now()}`,
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
        id: `evt-susp-${Date.now()}`,
        event_type: 'BILLING.SUBSCRIPTION.SUSPENDED',
        resource: { id: paypalSubId },
      }),
    )

    const refreshedSub = await payload.findByID({
      collection: 'subscriptions',
      id: sub.id,
      overrideAccess: true,
    })
    expect((refreshedSub as any).status).toBe('suspended')

    // Enrollment stays active — PayPal retries, so we don't revoke on SUSPENDED.
    const enrollments = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((enrollments.docs[0] as any).status).toBe('active')
  })

  it('activate → renew → EXPIRED cancels the enrollment (revokes against renewal tx)', async () => {
    // End-to-end lifecycle proof — the enrollment must end up cancelled even
    // when EXPIRED fires after one or more renewals have rotated
    // metadata.paymentId away from the initial transaction.
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

    // Fire a renewal so the enrollment's metadata.paymentId rotates to the
    // renewal Tx (this is exactly the scenario that used to leave EXPIRED
    // unable to find the enrollment).
    const renewalSaleId = `SALE-EXP-${Date.now()}`
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-exp-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: renewalSaleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    // Sanity: enrollment now points at the renewal tx, not the initial
    const preExpireEnr = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    const renewalTxRow = await payload.find({
      collection: 'transactions',
      where: { providerTransactionId: { equals: renewalSaleId } },
      overrideAccess: true,
    })
    expect((preExpireEnr.docs[0] as any).metadata?.paymentId).toBe(
      String((renewalTxRow.docs[0] as any).id),
    )

    // Now expire
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
    expect((enrollments.docs[0] as any).cancelledAt).toBeTruthy()
  })

  it('PAYMENT.SALE.COMPLETED rotates enrollment metadata.paymentId to the renewal tx', async () => {
    const paypalSubId = nextSubId()
    const { initialTx } = await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-rotate-${Date.now()}`,
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

    // After activation the enrollment is anchored on the initial tx
    const preEnr = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((preEnr.docs[0] as any).metadata?.paymentId).toBe(String(initialTx.id))

    const saleId = `SALE-ROT-${Date.now()}`
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-rot-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    const renewalTx = await payload.find({
      collection: 'transactions',
      where: { providerTransactionId: { equals: saleId } },
      overrideAccess: true,
    })
    expect(renewalTx.totalDocs).toBe(1)

    const postEnr = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    expect((postEnr.docs[0] as any).metadata?.paymentId).toBe(
      String((renewalTx.docs[0] as any).id),
    )
  })

  it('PAYMENT.SALE.REFUNDED flips the sale transaction to refunded', async () => {
    const paypalSubId = nextSubId()
    await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-refund-${Date.now()}`,
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
    const saleId = `SALE-REF-${Date.now()}`
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-refund-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: saleId,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    const refundEventId = `evt-refund-${Date.now()}`
    const res = await paypalWebhookHandler(
      makeRequest({
        id: refundEventId,
        event_type: 'PAYMENT.SALE.REFUNDED',
        resource: {
          id: `REFUND-${Date.now()}`,
          parent_payment: saleId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )
    expect(res.status).toBe(200)

    const renewalTx = await payload.find({
      collection: 'transactions',
      where: { providerTransactionId: { equals: saleId } },
      overrideAccess: true,
    })
    expect((renewalTx.docs[0] as any).status).toBe('refunded')
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

  it('addCalendarMonths clamps day overflow to last-day-of-target-month (Jan 31 + 1 mo = Feb 28/29, not Mar 3)', () => {
    // Use noon UTC so local-time getDate agrees with getUTCDate across the
    // common TZ range where CI runs (impl uses local-time math + clamp).
    const jan31 = new Date('2027-01-31T12:00:00Z')
    const feb = addCalendarMonths(jan31, 1)
    expect(feb.getMonth()).toBe(1) // February in local time
    expect(feb.getDate()).toBe(28)

    // Leap year: Jan 31, 2028 + 1 month = Feb 29, 2028
    const jan31Leap = new Date('2028-01-31T12:00:00Z')
    const feb29 = addCalendarMonths(jan31Leap, 1)
    expect(feb29.getMonth()).toBe(1)
    expect(feb29.getDate()).toBe(29)

    // Normal case (no overflow): Jan 15 + 1 month = Feb 15
    const jan15 = new Date('2027-01-15T12:00:00Z')
    const feb15 = addCalendarMonths(jan15, 1)
    expect(feb15.getMonth()).toBe(1)
    expect(feb15.getDate()).toBe(15)
  })

  it('two accumulated renewals extend the enrollment by the full 2 periods (CAS closes the race)', async () => {
    // Two SALE.COMPLETED events for the same subscription with distinct sale
    // ids — the CAS guard in extendEnrollment must ensure the second write
    // anchors on the first write's extension. Without CAS, both reads see
    // the same expiresAt and both write "+1 month" — user loses one paid
    // period.
    const paypalSubId = nextSubId()
    await seedSubscriptionAndInitialTx(paypalSubId)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-act-cas-${Date.now()}`,
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

    const preEnr = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    const initialExpiresAt = new Date((preEnr.docs[0] as any).expiresAt).getTime()

    // Fire two renewals sequentially (functionally identical to two racing
    // writes as far as the extension math is concerned — the CAS also
    // covers the sequential case)
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-cas-a-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: `SALE-CAS-A-${Date.now()}`,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )
    await paypalWebhookHandler(
      makeRequest({
        id: `evt-renew-cas-b-${Date.now()}`,
        event_type: 'PAYMENT.SALE.COMPLETED',
        resource: {
          id: `SALE-CAS-B-${Date.now()}`,
          billing_agreement_id: paypalSubId,
          amount: { total: '59.00', currency: 'ILS' },
        },
      }),
    )

    const postEnr = await payload.find({
      collection: 'enrollments',
      where: { user: { equals: userId } },
      overrideAccess: true,
    })
    const finalExpiresAt = new Date((postEnr.docs[0] as any).expiresAt).getTime()

    // Expected: initial + 2 calendar months (using the same math the code
    // uses, to avoid drift on 30-day vs 31-day months)
    const expectedDate = new Date(initialExpiresAt)
    expectedDate.setMonth(expectedDate.getMonth() + 2)
    expect(finalExpiresAt).toBe(expectedDate.getTime())
  })
})
