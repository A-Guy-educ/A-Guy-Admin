import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'

interface LessonsCollectionFields {
  description?: unknown
  prerequisites?: unknown
  order?: unknown
}

async function ensureDefaultTenant(payload: Payload): Promise<string> {
  const slug = getDefaultTenantSlug()
  const existing = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0].id
  const created = await payload.create({
    collection: 'tenants',
    data: { name: slug, slug, status: 'active' },
    overrideAccess: true,
  })
  return created.id
}

describe('Lesson prerequisites (#124)', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let courseId: string
  let chapterId: string
  const lessonIds: string[] = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    tenantId = await ensureDefaultTenant(payload)
    const timestamp = Date.now()
    const category = await payload.create({
      collection: 'categories',
      data: {
        title: `Prereq Category ${timestamp}`,
        slug: `prereq-category-${timestamp}`,
        locale: 'he',
      },
    })
    categoryId = category.id
    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `PR-${timestamp}`,
        title: `Prereq Course ${timestamp}`,
        locale: 'he',
        categories: [categoryId],
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        accessType: 'free',
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      draft: false,
    })
    courseId = course.id
    const chapter = await payload.create({
      collection: 'chapters',
      data: {
        title: `Prereq Chapter ${timestamp}`,
        chapterLabel: `P-${timestamp}`,
        course: courseId,
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
      },
    })
    chapterId = chapter.id
  })

  afterAll(async () => {
    for (const lessonId of lessonIds) {
      try {
        await payload.delete({ collection: 'lessons', id: lessonId, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    try {
      await payload.delete({ collection: 'chapters', id: chapterId, overrideAccess: true })
    } catch {
      /* ignore */
    }
    try {
      await payload.delete({ collection: 'courses', id: courseId, overrideAccess: true })
    } catch {
      /* ignore */
    }
    try {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    } catch {
      /* ignore */
    }
    await payload.db?.destroy?.()
  })

  it('exposes the prerequisites field on the lessons collection schema', () => {
    const lessonsCollection = payload.collections.lessons
    const fields = lessonsCollection?.config?.fields as Array<{
      name?: string
      type?: string
      relationTo?: string | string[]
      hasMany?: boolean
      admin?: { description?: string; hidden?: boolean }
    }>

    expect(fields).toBeDefined()
    const prereqField = fields.find((field) => field.name === 'prerequisites')
    expect(prereqField).toBeDefined()
    expect(prereqField?.type).toBe('relationship')
    expect(prereqField?.relationTo).toBe('lessons')
    expect(prereqField?.hasMany).toBe(true)
    expect(prereqField?.admin?.hidden).toBeFalsy()
    expect(prereqField?.admin?.description).toBe(
      'Lessons students should complete before this lesson',
    )
  })

  it('orders the prerequisites field directly under description and above order', () => {
    const lessonsCollection = payload.collections.lessons
    const fields = (lessonsCollection?.config?.fields as Array<{ name?: string }>) ?? []
    const descriptionIndex = fields.findIndex((field) => field.name === 'description')
    const prereqIndex = fields.findIndex((field) => field.name === 'prerequisites')
    const orderIndex = fields.findIndex((field) => field.name === 'order')

    expect(descriptionIndex).toBeGreaterThanOrEqual(0)
    expect(prereqIndex).toBeGreaterThanOrEqual(0)
    expect(orderIndex).toBeGreaterThanOrEqual(0)
    expect(prereqIndex).toBe(descriptionIndex + 1)
    expect(orderIndex).toBe(prereqIndex + 1)
  })

  it('persists prerequisites as a relation array of lesson IDs and exposes them via Local API', async () => {
    const baseLesson = await payload.create({
      collection: 'lessons',
      data: {
        title: 'Prereq Base Lesson',
        chapter: chapterId,
        type: 'learning',
        order: 10,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
        accessType: 'inherit',
        contentStatus: 'none',
        contentStatusVisible: true,
      } as any,
      draft: false,
    })
    lessonIds.push(baseLesson.id)

    const dependentLesson = await payload.create({
      collection: 'lessons',
      data: {
        title: 'Prereq Dependent Lesson',
        chapter: chapterId,
        type: 'learning',
        order: 11,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
        accessType: 'inherit',
        contentStatus: 'none',
        contentStatusVisible: true,
        prerequisites: [baseLesson.id],
      } as any,
      draft: false,
    })
    lessonIds.push(dependentLesson.id)

    expect(Array.isArray(dependentLesson.prerequisites)).toBe(true)
    expect((dependentLesson.prerequisites as unknown[]).length).toBe(1)

    const refetched = await payload.findByID({
      collection: 'lessons',
      id: dependentLesson.id,
      depth: 0,
      overrideAccess: true,
    })

    expect(Array.isArray(refetched.prerequisites)).toBe(true)
    expect((refetched.prerequisites as unknown[]).map(String)).toContain(String(baseLesson.id))
  })

  it('returns the prerequisites key for lessons created without prerequisites', async () => {
    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: 'Lesson With Empty Prereqs',
        chapter: chapterId,
        type: 'learning',
        order: 12,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
        accessType: 'inherit',
        contentStatus: 'none',
        contentStatusVisible: true,
      } as any,
      draft: false,
    })
    lessonIds.push(lesson.id)

    const refetched = await payload.findByID({
      collection: 'lessons',
      id: lesson.id,
      depth: 0,
      overrideAccess: true,
    })

    const fieldsRecord = refetched as unknown as LessonsCollectionFields
    expect('prerequisites' in fieldsRecord).toBe(true)
  })

  it('rejects invalid prerequisite IDs that do not point at a lesson', async () => {
    await expect(
      payload.create({
        collection: 'lessons',
        data: {
          title: 'Bad Prereq Lesson',
          chapter: chapterId,
          type: 'learning',
          order: 13,
          status: 'published',
          isActive: true,
          tenant: tenantId,
          locale: 'he',
          accessType: 'inherit',
          contentStatus: 'none',
          contentStatusVisible: true,
          prerequisites: ['not-a-real-lesson-id'],
        } as any,
        draft: false,
      }),
    ).rejects.toThrow()
  })
})
