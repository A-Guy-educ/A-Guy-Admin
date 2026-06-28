/**
 * Integration tests for Products + Features (post content-blocks refactor)
 *
 * Covers:
 * - Product CRUD as admin, public read, billingType/interval validation
 * - Time-limited fields (durationDays, maxDevices)
 * - contents blocks: courseBlock + featureBlock composition
 * - Features collection: catalog CRUD and key normalization
 * - End-to-end prep-course composition mirroring the boss's spec
 *
 * @fileType integration-test
 * @domain billing
 * @ai-summary Tests Products/Features schema and bundle composition via inline content blocks
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AccountRole } from '@/server/payload/collections/Users/roles'
import config from '@payload-config'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const hasDatabaseUrl = !!process.env.DATABASE_URL

let payload: Payload
let adminUserId: string
let studentUserId: string
const createdProductIds: string[] = []
const createdFeatureIds: string[] = []
const createdLessonIds: string[] = []
const createdChapterIds: string[] = []
const createdCourseIds: string[] = []
const createdCategoryIds: string[] = []

beforeAll(async () => {
  if (!hasDatabaseUrl) return
  payload = await getPayload({ config })

  const admin = await payload.create({
    collection: 'users',
    data: {
      email: `product-billing-admin-${Date.now()}@example.com`,
      password: 'test123456',
    } as any,
  })
  await payload.update({
    collection: 'users',
    id: admin.id,
    data: { role: AccountRole.Admin },
    overrideAccess: true,
  })
  adminUserId = admin.id

  const student = await payload.create({
    collection: 'users',
    data: {
      email: `product-billing-student-${Date.now()}@example.com`,
      password: 'test123456',
      role: AccountRole.Student,
    } as any,
  })
  studentUserId = student.id
}, 300_000)

afterEach(async () => {
  if (!payload) return
  for (const id of createdProductIds.splice(0)) {
    await payload.delete({ collection: 'products', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of createdFeatureIds.splice(0)) {
    await payload.delete({ collection: 'features', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of createdLessonIds.splice(0)) {
    await payload.delete({ collection: 'lessons', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of createdChapterIds.splice(0)) {
    await payload.delete({ collection: 'chapters', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of createdCourseIds.splice(0)) {
    await payload.delete({ collection: 'courses', id, overrideAccess: true }).catch(() => {})
  }
  for (const id of createdCategoryIds.splice(0)) {
    await payload.delete({ collection: 'categories', id, overrideAccess: true }).catch(() => {})
  }
})

afterAll(async () => {
  if (!payload) return
  for (const userId of [adminUserId, studentUserId]) {
    if (userId) {
      await payload
        .delete({ collection: 'users', id: userId, overrideAccess: true })
        .catch(() => {})
    }
  }
  if (payload.db?.destroy) await payload.db.destroy()
})

async function getAdminUser() {
  return payload.findByID({ collection: 'users', id: adminUserId, overrideAccess: true })
}
async function getStudentUser() {
  return payload.findByID({ collection: 'users', id: studentUserId, overrideAccess: true })
}

async function createTestCourse(title: string): Promise<string> {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const category = await payload.create({
    collection: 'categories',
    data: { title: `${title} cat`, slug: `pb-cat-${ts}` } as any,
    overrideAccess: true,
  })
  createdCategoryIds.push(category.id)

  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: `PB-${ts.slice(-6)}`,
      title: `${title} Course`,
      slug: `pb-course-${ts}`,
      categories: [category.id],
      order: 1,
      status: 'published',
      isActive: true,
    },
    draft: true,
    overrideAccess: true,
  } as any)
  createdCourseIds.push(course.id)
  return course.id
}

async function createFeature(
  key: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const existing = (
    await payload.find({
      collection: 'features',
      where: { key: { equals: key } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0] as { id: string } | undefined
  if (existing) {
    // Don't track features the seed already created — they belong to the
    // catalog and should survive the test.
    return existing.id
  }
  const created = (await payload.create({
    collection: 'features',
    data: {
      key,
      label: key,
      type: 'numeric',
      defaultPeriod: 'day',
      enforcement: 'enforced',
      isActive: true,
      ...overrides,
    },
    overrideAccess: true,
  })) as { id: string }
  createdFeatureIds.push(created.id)
  return created.id
}

// ---------------------------------------------------------------------------
// Products — basics
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabaseUrl)('Products — basic CRUD + validation', () => {
  it('creates a one-time product with required fields', async () => {
    const admin = await getAdminUser()
    const product = await payload.create({
      collection: 'products',
      data: {
        name: 'Basic Package',
        billingType: 'one_time',
        price: 99,
        currency: 'USD',
        isActive: true,
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdProductIds.push(product.id)
    expect(product.slug).toBeDefined()
  })

  it('rejects subscription billing without an interval', async () => {
    const admin = await getAdminUser()
    let err: Error | null = null
    try {
      await payload.create({
        collection: 'products',
        data: {
          name: 'Bad Subscription',
          billingType: 'subscription',
          price: 99,
          currency: 'USD',
        } as any,
        user: admin as any,
        overrideAccess: false,
      })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
  })

  it('denies a student from creating products', async () => {
    const student = await getStudentUser()
    let err: Error | null = null
    try {
      await payload.create({
        collection: 'products',
        data: {
          name: 'Student Attempt',
          billingType: 'one_time',
          price: 9,
          currency: 'USD',
        } as any,
        user: student as any,
        overrideAccess: false,
      })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
    expect((err as any).status).toBeGreaterThanOrEqual(400)
  })
})

// ---------------------------------------------------------------------------
// Time-limited fields
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabaseUrl)('Products — durationDays + maxDevices', () => {
  it('persists durationDays and maxDevices', async () => {
    const admin = await getAdminUser()
    const product = await payload.create({
      collection: 'products',
      data: {
        name: 'Time-Limited',
        billingType: 'one_time',
        price: 300,
        currency: 'ILS',
        durationDays: 90,
        maxDevices: 2,
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdProductIds.push(product.id)
    expect((product as any).durationDays).toBe(90)
    expect((product as any).maxDevices).toBe(2)
  })

  it('rejects durationDays below 1', async () => {
    const admin = await getAdminUser()
    let err: Error | null = null
    try {
      await payload.create({
        collection: 'products',
        data: {
          name: 'Bad Duration',
          billingType: 'one_time',
          price: 100,
          currency: 'ILS',
          durationDays: 0,
        } as any,
        user: admin as any,
        overrideAccess: false,
      })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
  })

  it('allows omitting durationDays (lifetime)', async () => {
    const admin = await getAdminUser()
    const product = await payload.create({
      collection: 'products',
      data: {
        name: 'Lifetime',
        billingType: 'one_time',
        price: 500,
        currency: 'ILS',
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdProductIds.push(product.id)
    expect((product as any).durationDays ?? null).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Features catalog
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabaseUrl)('Features catalog', () => {
  it('creates a feature with normalized key (trim + lowercase)', async () => {
    const admin = await getAdminUser()
    const created = await payload.create({
      collection: 'features',
      data: {
        key: '  Custom-Feature-Key  ',
        label: 'Custom Feature',
        type: 'boolean',
        defaultPeriod: 'lifetime',
        enforcement: 'metadata',
        isActive: true,
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdFeatureIds.push(created.id)
    expect((created as any).key).toBe('custom-feature-key')
  })

  it('rejects duplicate keys', async () => {
    const admin = await getAdminUser()
    const ts = Date.now()
    const first = await payload.create({
      collection: 'features',
      data: {
        key: `dup-key-${ts}`,
        label: 'First',
        type: 'boolean',
        defaultPeriod: 'lifetime',
        enforcement: 'metadata',
        isActive: true,
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdFeatureIds.push(first.id)

    let err: Error | null = null
    try {
      await payload.create({
        collection: 'features',
        data: {
          key: `dup-key-${ts}`,
          label: 'Second',
          type: 'boolean',
          defaultPeriod: 'lifetime',
          enforcement: 'metadata',
          isActive: true,
        } as any,
        user: admin as any,
        overrideAccess: false,
      })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Products — contents blocks composition
// ---------------------------------------------------------------------------

describe.skipIf(!hasDatabaseUrl)('Products.contents blocks', () => {
  it('composes a product with a courseBlock', async () => {
    const admin = await getAdminUser()
    const courseId = await createTestCourse('Block Test')

    const product = await payload.create({
      collection: 'products',
      data: {
        name: 'Course-Only Product',
        billingType: 'one_time',
        price: 100,
        currency: 'ILS',
        contents: [
          { blockType: 'courseBlock', course: courseId, lessonTypes: ['learning', 'practice'] },
        ],
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdProductIds.push(product.id)

    const reRead = await payload.findByID({
      collection: 'products',
      id: product.id,
      depth: 1,
      overrideAccess: true,
    })
    const contents = (reRead as any).contents as any[]
    expect(contents.length).toBe(1)
    expect(contents[0].blockType).toBe('courseBlock')
    expect(contents[0].lessonTypes).toEqual(expect.arrayContaining(['learning', 'practice']))
  })

  it('composes a product with a featureBlock referencing a Feature row', async () => {
    const admin = await getAdminUser()
    const featureId = await createFeature(`ft-${Date.now()}`)

    const product = await payload.create({
      collection: 'products',
      data: {
        name: 'Feature-Only Product',
        billingType: 'one_time',
        price: 50,
        currency: 'ILS',
        contents: [{ blockType: 'featureBlock', feature: featureId, limit: 5, period: 'day' }],
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdProductIds.push(product.id)

    const reRead = await payload.findByID({
      collection: 'products',
      id: product.id,
      depth: 1,
      overrideAccess: true,
    })
    const block = ((reRead as any).contents as any[])[0]
    expect(block.blockType).toBe('featureBlock')
    expect(block.limit).toBe(5)
    expect(block.period).toBe('day')
    // depth=1 populates the feature relationship to the row
    expect(block.feature?.id ?? block.feature).toBeDefined()
  })

  it('rejects featureBlock without a feature relationship', async () => {
    const admin = await getAdminUser()
    let err: Error | null = null
    try {
      await payload.create({
        collection: 'products',
        data: {
          name: 'Missing Feature Ref',
          billingType: 'one_time',
          price: 50,
          currency: 'ILS',
          contents: [{ blockType: 'featureBlock', limit: 5, period: 'day' }],
        } as any,
        user: admin as any,
        overrideAccess: false,
      })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
  })

  it('composes the full הכנה לכיתה ז prep-course shape end-to-end', async () => {
    const admin = await getAdminUser()
    const courseId = await createTestCourse('Prep 7th Grade')
    const aiQuestionsId = await createFeature('ai-questions')
    const chatLimitId = await createFeature('chat-limit')

    const product = await payload.create({
      collection: 'products',
      data: {
        name: 'הכנה לכיתה ז',
        billingType: 'one_time',
        price: 300,
        currency: 'ILS',
        durationDays: 90,
        maxDevices: 2,
        contents: [
          { blockType: 'courseBlock', course: courseId },
          { blockType: 'featureBlock', feature: aiQuestionsId, limit: 5, period: 'day' },
          { blockType: 'featureBlock', feature: chatLimitId, limit: 100, period: 'day' },
        ],
      } as any,
      user: admin as any,
      overrideAccess: false,
    })
    createdProductIds.push(product.id)

    const reRead = await payload.findByID({
      collection: 'products',
      id: product.id,
      depth: 1,
      overrideAccess: true,
    })
    expect((reRead as any).durationDays).toBe(90)
    expect((reRead as any).maxDevices).toBe(2)
    const blocks = (reRead as any).contents as any[]
    expect(blocks.length).toBe(3)
    expect(blocks.filter((b) => b.blockType === 'featureBlock').length).toBe(2)
    expect(blocks.filter((b) => b.blockType === 'courseBlock').length).toBe(1)
  })
})
