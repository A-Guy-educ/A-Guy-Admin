/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { AccountRole } from '@/infra/auth/roles'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'

interface BlockEntry {
  id: string
  blockType: 'sectionRef'
  section?: string
}

function parseBlocks(raw: unknown): BlockEntry[] {
  if (Array.isArray(raw)) return raw as BlockEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockEntry[]
    } catch {
      // ignore
    }
  }
  return []
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

async function seedHierarchy(payload: Payload, tenantId: string, categoryId: string) {
  const timestamp = Date.now() + Math.floor(Math.random() * 10_000)
  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: `S-${timestamp}`,
      title: `Sections Course ${timestamp}`,
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
    overrideAccess: true,
  })
  const chapter = await payload.create({
    collection: 'chapters',
    data: {
      title: `Sections Chapter ${timestamp}`,
      chapterLabel: `S-${timestamp}`,
      course: course.id,
      order: 0,
      status: 'published',
      isActive: true,
      tenant: tenantId,
      locale: 'he',
    },
    overrideAccess: true,
  })
  const lesson = await payload.create({
    collection: 'lessons',
    data: {
      title: `Sections Lesson ${timestamp}`,
      chapter: chapter.id,
      type: 'practice',
      order: 0,
      status: 'published',
      isActive: true,
      tenant: tenantId,
      locale: 'he',
      accessType: 'inherit',
      contentStatus: 'none',
      contentStatusVisible: true,
    } as any,
    draft: false,
    overrideAccess: true,
  })
  return { courseId: course.id, chapterId: chapter.id, lessonId: lesson.id }
}

describe('Sections collection — sync + hierarchy', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let adminReq: any

  const sectionIds: string[] = []
  const exerciseIds: string[] = []
  const lessonIds: string[] = []
  const chapterIds: string[] = []
  const courseIds: string[] = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    tenantId = await ensureDefaultTenant(payload)
    const timestamp = Date.now()

    const admin = await payload.create({
      collection: 'users',
      data: {
        email: `sections-admin-${timestamp}@test.local`,
        password: 'test-password-1234',
        name: 'Sections Admin',
      } as any,
    })
    await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: AccountRole.Admin } as any,
      overrideAccess: true,
    })
    const adminUser = await payload.findByID({
      collection: 'users',
      id: admin.id,
      overrideAccess: true,
    })
    adminReq = { user: adminUser }

    const category = await payload.create({
      collection: 'categories',
      data: {
        title: `Sections Category ${timestamp}`,
        slug: `sections-category-${timestamp}`,
        locale: 'he',
      },
    })
    categoryId = category.id
  }, 120_000)

  afterAll(async () => {
    for (const id of sectionIds) {
      try {
        await payload.delete({ collection: 'sections', id, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    for (const id of exerciseIds) {
      try {
        await payload.delete({ collection: 'exercises', id, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    for (const id of lessonIds) {
      try {
        await payload.delete({ collection: 'lessons', id, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    for (const id of chapterIds) {
      try {
        await payload.delete({ collection: 'chapters', id, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    for (const id of courseIds) {
      try {
        await payload.delete({ collection: 'courses', id, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    try {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    } catch {
      /* ignore */
    }
    await payload.db?.destroy?.()
  }, 120_000)

  async function seedExerciseWithHierarchy() {
    const hierarchy = await seedHierarchy(payload, tenantId, categoryId)
    courseIds.push(hierarchy.courseId)
    chapterIds.push(hierarchy.chapterId)
    lessonIds.push(hierarchy.lessonId)

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: `Sections Exercise ${Date.now()}`,
        lesson: hierarchy.lessonId,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)
    return { ...hierarchy, exerciseId: exercise.id }
  }

  it('creates a section and writes a sectionRef block into the parent exercise', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'First Section',
        exercise: exerciseId,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(section.id)

    const exercise = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
    })
    const blocks = parseBlocks(exercise.blocks)
    expect(blocks.some((b) => b.blockType === 'sectionRef' && b.section === section.id)).toBe(true)
  })

  it('populates denormalized lesson/chapter/course fields from the parent exercise', async () => {
    const { exerciseId, lessonId, chapterId, courseId } = await seedExerciseWithHierarchy()

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'Hierarchy Section',
        exercise: exerciseId,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
      draft: true,
    })
    sectionIds.push(section.id)

    expect(typeof section.lesson === 'string' ? section.lesson : section.lesson?.id).toBe(lessonId)
    expect(typeof section.chapter === 'string' ? section.chapter : section.chapter?.id).toBe(
      chapterId,
    )
    expect(typeof section.course === 'string' ? section.course : section.course?.id).toBe(courseId)
  })

  it('reassigning a section to a different exercise moves the sectionRef block', async () => {
    const { exerciseId: exerciseA } = await seedExerciseWithHierarchy()
    const { exerciseId: exerciseB } = await seedExerciseWithHierarchy()

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'Reassigned Section',
        exercise: exerciseA,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(section.id)

    // Sanity: parent A has the block
    const beforeA = await payload.findByID({
      collection: 'exercises',
      id: exerciseA,
      depth: 0,
      overrideAccess: true,
    })
    expect(parseBlocks(beforeA.blocks).some((b) => b.section === section.id)).toBe(true)

    // Reassign
    await payload.update({
      collection: 'sections',
      id: section.id,
      data: { exercise: exerciseB } as any,
      overrideAccess: true,
      req: adminReq,
    })

    const afterA = await payload.findByID({
      collection: 'exercises',
      id: exerciseA,
      depth: 0,
      overrideAccess: true,
    })
    const afterB = await payload.findByID({
      collection: 'exercises',
      id: exerciseB,
      depth: 0,
      overrideAccess: true,
    })

    expect(parseBlocks(afterA.blocks).some((b) => b.section === section.id)).toBe(false)
    expect(parseBlocks(afterB.blocks).some((b) => b.section === section.id)).toBe(true)
  })

  it('deleting a section removes the sectionRef block from the parent exercise', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'To Be Deleted',
        exercise: exerciseId,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
      draft: true,
    })

    await payload.delete({
      collection: 'sections',
      id: section.id,
      overrideAccess: true,
      req: adminReq,
    })

    const exercise = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
    })
    expect(parseBlocks(exercise.blocks).some((b) => b.section === section.id)).toBe(false)
  })

  it('does not double-write denormalized fields on content-promotion import', async () => {
    const { exerciseId, lessonId } = await seedExerciseWithHierarchy()

    // The import path bypasses the beforeChange chain's two findByID calls
    // when the import marker is present. Verify the marker behavior end-to-end
    // by creating the section under a flagged request context.
    const flagReq: any = { user: adminReq.user, context: {} }
    markRequestAsContentPromotionImport(flagReq)

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'Imported Section',
        exercise: exerciseId,
        order: 1,
        tenant: tenantId,
        // Bundle carries denormalized fields verbatim — pre-populate to assert
        // they round-trip unchanged (no second-lookup overwriting).
        lesson: lessonId,
      } as any,
      overrideAccess: true,
      req: flagReq,
      draft: true,
    })
    sectionIds.push(section.id)

    expect(typeof section.lesson === 'string' ? section.lesson : section.lesson?.id).toBe(lessonId)
  })
})
