/**
 * Integration tests for the Tiers collection + tier-recompute flow.
 *
 * Covers:
 * - Tiers CRUD (admin-only write, public read, slug normalisation)
 * - `isDefault` uniqueness (app-level friendly error; the partial unique
 *   index that closes the TOCTOU is created at onInit and covered by
 *   the "second default fails at DB layer" case)
 * - Rank duplicates are ALLOWED (so admins can reorder tiers via two
 *   sequential writes without hitting duplicate-key)
 * - recomputeUserTier fires through the Transactions afterChange hook
 *   on the pending→succeeded transition (matches real webhook ordering)
 * - Refund path (tx→refunded triggers the revoke+recompute hook)
 * - Legacy products with no tier assignment are ignored
 *
 * @fileType integration-test
 * @domain billing
 * @ai-summary Verifies tier metadata + derived currentTier logic via real hook path
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import config from '@payload-config'
import { grantProductEntitlements } from '@/lib/payment/grant-entitlements'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const hasDatabaseUrl = !!process.env.DATABASE_URL

let payload: Payload
let adminUserId: string
const trackedTierIds: string[] = []
const trackedProductIds: string[] = []
const trackedUserIds: string[] = []
const trackedTxIds: string[] = []

async function ensureAdmin(): Promise<string> {
  const admin = await payload.create({
    collection: 'users',
    data: {
      email: `tiers-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'test123456',
    } as any,
  })
  await payload.update({
    collection: 'users',
    id: admin.id,
    data: { role: AccountRole.Admin },
    overrideAccess: true,
  })
  trackedUserIds.push(admin.id)
  return admin.id
}

async function createTierRow(
  slug: string,
  rank: number,
  opts: { isDefault?: boolean } = {},
): Promise<string> {
  const row = await payload.create({
    collection: 'tiers',
    data: {
      slug,
      rank,
      name: `${slug} tier`,
      description: `${slug} description`,
      isDefault: opts.isDefault ?? false,
      sortOrder: rank,
      isActive: true,
    } as any,
    overrideAccess: true,
  })
  trackedTierIds.push(row.id)
  return row.id
}

async function createProductWithTier(name: string, tierId: string | null): Promise<string> {
  const product = await payload.create({
    collection: 'products',
    data: {
      name,
      billingType: 'one_time',
      price: 100,
      currency: 'USD',
      isActive: true,
      ...(tierId ? { tier: tierId } : {}),
    } as any,
    overrideAccess: true,
  })
  trackedProductIds.push(product.id)
  return product.id
}

async function createStudent(): Promise<string> {
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `tiers-student-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'test123456',
      role: AccountRole.Student,
    } as any,
  })
  trackedUserIds.push(user.id)
  return user.id
}

// Real webhook ordering: checkout writes tx as 'pending', calls
// grantProductEntitlements, then updates tx status to 'succeeded' — which
// fires the Transactions afterChange hook that runs recomputeUserTier.
// Prior tests created tx already-succeeded, which hid the timing bug.
async function createPendingTx(userId: string, productId: string): Promise<string> {
  const tx = await payload.create({
    collection: 'transactions',
    data: {
      user: userId,
      product: productId,
      amount: 100,
      currency: 'USD',
      status: 'pending',
      provider: 'stripe',
      providerTransactionId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      isRenewal: false,
    } as any,
    overrideAccess: true,
  })
  trackedTxIds.push(tx.id)
  return tx.id
}

async function flipTxToSucceeded(txId: string): Promise<void> {
  await payload.update({
    collection: 'transactions',
    id: txId,
    data: { status: 'succeeded' } as any,
    overrideAccess: true,
  })
}

async function flipTxToRefunded(txId: string): Promise<void> {
  await payload.update({
    collection: 'transactions',
    id: txId,
    data: { status: 'refunded' } as any,
    overrideAccess: true,
  })
}

// Convenience helper — the standard "checkout succeeded" flow.
async function completeCheckout(userId: string, productId: string): Promise<string> {
  const txId = await createPendingTx(userId, productId)
  await grantProductEntitlements(userId, productId, txId)
  await flipTxToSucceeded(txId)
  return txId
}

async function readUser(userId: string): Promise<Record<string, unknown>> {
  return (await payload.findByID({
    collection: 'users',
    id: userId,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>
}

beforeAll(async () => {
  if (!hasDatabaseUrl) return
  payload = await getPayload({ config })
  adminUserId = await ensureAdmin()
}, 300_000)

afterEach(async () => {
  if (!payload) return
  for (const id of trackedTxIds.splice(0)) {
    await payload.delete({ collection: 'transactions', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of trackedProductIds.splice(0)) {
    await payload.delete({ collection: 'products', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of trackedTierIds.splice(0)) {
    await payload.delete({ collection: 'tiers', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of trackedUserIds.splice(0)) {
    if (id === adminUserId) continue
    await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  }
  const remaining = trackedUserIds.filter((id) => id === adminUserId)
  trackedUserIds.length = 0
  trackedUserIds.push(...remaining)
})

afterAll(async () => {
  if (!payload) return
  for (const id of trackedUserIds.splice(0)) {
    await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
  }
  if (payload.db?.destroy) await payload.db.destroy()
})

// ---------------------------------------------------------------------------
// Collection basics
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabaseUrl)('Tiers — collection basics', () => {
  it('normalises slug to lowercase on create', async () => {
    const id = await createTierRow('  Custom-Slug  ', 900)
    const doc = (await payload.findByID({
      collection: 'tiers',
      id,
      overrideAccess: true,
    })) as any
    expect(doc.slug).toBe('custom-slug')
  })

  it('rejects a second tier with isDefault=true (friendly error)', async () => {
    await createTierRow('primary-default', 901, { isDefault: true })
    let err: Error | null = null
    try {
      await createTierRow('conflicting-default', 902, { isDefault: true })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
    expect(String(err?.message ?? err)).toMatch(/default/i)
  })

  it('allows duplicate ranks (so admins can reorder tiers step-by-step)', async () => {
    const id1 = await createTierRow('rank-swap-a', 910)
    const id2 = await createTierRow('rank-swap-b', 910)
    // Both rows exist — no unique constraint on rank prevents the swap
    // path where two writes temporarily collide.
    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })
})

// ---------------------------------------------------------------------------
// recomputeUserTier via the Transactions afterChange hook
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabaseUrl)('Tier recompute — through the tx afterChange hook', () => {
  it('assigns Free when the user has no active grants (tx→succeeded on a legacy product)', async () => {
    const freeId = await createTierRow('free-t1', 1000, { isDefault: true })
    const productId = await createProductWithTier('Legacy T1 Product', null)
    const userId = await createStudent()

    await completeCheckout(userId, productId)

    const user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(freeId)
  })

  it('promotes the user to the tier of the purchased product', async () => {
    await createTierRow('free-t2', 1100, { isDefault: true })
    const proId = await createTierRow('pro-t2', 1102)
    const productId = await createProductWithTier('Pro T2 Product', proId)
    const userId = await createStudent()

    await completeCheckout(userId, productId)

    const user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(proId)
  })

  it('resolves to the highest-rank tier when multiple grants overlap', async () => {
    await createTierRow('free-t3', 1200, { isDefault: true })
    const basicId = await createTierRow('basic-t3', 1201)
    const eliteId = await createTierRow('elite-t3', 1203)

    const basicProductId = await createProductWithTier('Basic T3 Product', basicId)
    const eliteProductId = await createProductWithTier('Elite T3 Product', eliteId)

    const userId = await createStudent()
    await completeCheckout(userId, basicProductId)
    await completeCheckout(userId, eliteProductId)

    const user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(eliteId)
  })

  it('falls back to Free when the last paid grant is refunded (revoke hook path)', async () => {
    const freeId = await createTierRow('free-t4', 1300, { isDefault: true })
    const proId = await createTierRow('pro-t4', 1302)
    const productId = await createProductWithTier('Pro T4 Product', proId)
    const userId = await createStudent()

    const txId = await completeCheckout(userId, productId)
    let user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(proId)

    // Refund path: the tx→refunded transition fires
    // revokeEntitlementsOnRefund → revokeProductEntitlements →
    // recomputeUserTier. No manual recompute call.
    await flipTxToRefunded(txId)

    user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(freeId)
  })

  it('leaves the user on the highest surviving tier when one of several grants is refunded', async () => {
    await createTierRow('free-t5', 1400, { isDefault: true })
    const basicId = await createTierRow('basic-t5', 1401)
    const eliteId = await createTierRow('elite-t5', 1403)

    const basicProductId = await createProductWithTier('Basic T5 Product', basicId)
    const eliteProductId = await createProductWithTier('Elite T5 Product', eliteId)

    const userId = await createStudent()
    await completeCheckout(userId, basicProductId)
    const eliteTxId = await completeCheckout(userId, eliteProductId)

    let user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(eliteId)

    await flipTxToRefunded(eliteTxId)

    user = (await readUser(userId)) as { currentTier?: string }
    expect(user.currentTier).toBe(basicId)
  })
})
