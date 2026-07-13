/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { AccountRole } from '@/infra/auth/roles'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'

/**
 * Integration coverage for #176 — Section `adminTitle` (course / chapter /
 * lesson / exercise / section) and its import-skip guard.
 */
describe('Sections adminTitle — cascade + fallback', () => {
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

    const slug = getDefaultTenantSlug()
    const existing = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: slug } },
      limit: 1,
      overrideAccess: true,
    })
    tenantId = existing.docs[0]
      ? existing.docs[0].id
      : (
          await payload.create({
            collection: 'tenants',
            data: { name: slug, slug, status: 'active' },
            overrideAccess: true,
          })
        ).id

    const timestamp = Date.now()

    const admin = await payload.create({
      collection: 'users',
      data: {
        email: `sections-admin-title-${timestamp}@test.local`,
        password: 'test-password-1234',
        name: 'Sections Admin Title',
      } as any,
    })
    await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: AccountRole.Admin } as any,
      overrideAccess: true,
    })
    adminReq = {
      user: await payload.findByID({ collection: 'users', id: admin.id, overrideAccess: true }),
    }

    const category = await payload.create({
      collection: 'categories',
      data: {
        title: `Section AdminTitle Category ${timestamp}`,
        slug: `section-admin-title-${timestamp}`,
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

  async function seedHierarchy() {
    const stamp = Date.now() + Math.floor(Math.random() * 10_000)
    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `SAT-C-${stamp}`,
        title: `SAT Course ${stamp}`,
        locale: 'he',
        categories: [categoryId],
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        accessType: 'free',
        contentStatus: 'none',
        contentStatusVisible: true,
      } as any,
      draft: false,
      overrideAccess: true,
    })
    courseIds.push(course.id)
    const chapter = await payload.create({
      collection: 'chapters',
      data: {
        title: `SAT Chapter ${stamp}`,
        chapterLabel: `SATC-${stamp}`,
        course: course.id,
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
      } as any,
      overrideAccess: true,
    })
    chapterIds.push(chapter.id)
    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: `SAT Lesson ${stamp}`,
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
    lessonIds.push(lesson.id)
    return { course, chapter, lesson }
  }

  it('populates adminTitle as course / chapter / lesson / exercise / section on create', async () => {
    const { course, chapter, lesson } = await seedHierarchy()
    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: `SAT Exercise ${Date.now()}`,
        lesson: lesson.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'Demo Section',
        exerciseType: 'guide',
        exercise: exercise.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(section.id)

    // Mirrors the Lessons pattern: course + chapter segments are
    // "<label> <title>", the deeper levels are just titles.
    expect(section.adminTitle).toBe(
      [
        `${course.courseLabel} ${course.title}`,
        `${chapter.chapterLabel} ${chapter.title}`,
        lesson.title,
        exercise.title,
        section.title,
      ].join(' / '),
    )
  })

  // Note: an "orphan section" (no exercise) is not a supportable state —
  // `exercise` is `required: true` on the collection so the create would fail
  // validation before the fallback hook could run. Fallback behavior for a
  // broken parent chain is covered by the unit tests on `computeSectionAdminTitle`.

  it('recomputes adminTitle when the section is reassigned to a different exercise', async () => {
    const { lesson: lessonA } = await seedHierarchy()
    const { lesson: lessonB } = await seedHierarchy()
    const exerciseA = await payload.create({
      collection: 'exercises',
      data: {
        title: 'Exercise A',
        lesson: lessonA.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    const exerciseB = await payload.create({
      collection: 'exercises',
      data: {
        title: 'Exercise B',
        lesson: lessonB.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exerciseA.id, exerciseB.id)

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'Reassign Me',
        exerciseType: 'guide',
        exercise: exerciseA.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(section.id)

    expect(section.adminTitle).toContain('Exercise A')

    const updated = await payload.update({
      collection: 'sections',
      id: section.id,
      data: { exercise: exerciseB.id } as any,
      overrideAccess: true,
      req: adminReq,
    })

    expect(updated.adminTitle).toContain('Exercise B')
    expect(updated.adminTitle).not.toContain('Exercise A')
  })

  it('skips adminTitle recomputation during content-promotion imports', async () => {
    const { lesson } = await seedHierarchy()
    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: 'Bundled Exercise',
        lesson: lesson.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)

    const flagReq: any = { user: adminReq.user, context: {} }
    markRequestAsContentPromotionImport(flagReq)

    const section = await payload.create({
      collection: 'sections',
      data: {
        title: 'Imported Section',
        exerciseType: 'guide',
        exercise: exercise.id,
        // Bundles carry the denormalized title verbatim; the skip guard must
        // preserve it instead of recomputing the chain locally.
        adminTitle: 'Imported Section',
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: flagReq,
    })
    sectionIds.push(section.id)

    expect(section.adminTitle).toBe('Imported Section')
  })
})
