/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { AccountRole } from '@/infra/auth/roles'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'

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

describe('Exercise blocks — deletion persistence', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let courseId: string
  let chapterId: string

  let adminReq: any
  const lessonIds: string[] = []
  const exerciseIds: string[] = []
  const sectionIds: string[] = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    tenantId = await ensureDefaultTenant(payload)
    const timestamp = Date.now()
    const admin = await payload.create({
      collection: 'users',
      data: {
        email: `exercise-blocks-admin-${timestamp}@test.local`,
        password: 'test-password-1234',
        name: 'Exercise Blocks Delete Admin',
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
        title: `Exercise Blocks Delete Category ${timestamp}`,
        slug: `exercise-blocks-delete-category-${timestamp}`,
        locale: 'he',
      },
    })
    categoryId = category.id
    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `EBD-${timestamp}`,
        title: `Exercise Blocks Delete Course ${timestamp}`,
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
        title: `Exercise Blocks Delete Chapter ${timestamp}`,
        chapterLabel: `EBD-${timestamp}`,
        course: courseId,
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
      },
    })
    chapterId = chapter.id
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

  it('does not re-add a deleted sectionRef block when the section is later updated', async () => {
    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: 'Exercise Block Persistence Lesson',
        chapter: chapterId,
        type: 'learning',
        order: 200,
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

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: 'Exercise Hosting Sections',
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
        title: 'Section To Be Removed',
        exercise: exercise.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(section.id)

    // After create, afterChange should have appended the sectionRef block.
    const afterCreate = await payload.findByID({
      collection: 'exercises',
      id: exercise.id,
      depth: 0,
      overrideAccess: true,
    })
    const initialBlocks = parseBlocks(afterCreate.blocks)
    expect(initialBlocks.some((b) => b.section === section.id)).toBe(true)

    // Admin removes the block from the exercise (simulates ExerciseBlocksField delete + save).
    await payload.update({
      collection: 'exercises',
      id: exercise.id,
      data: { blocks: JSON.stringify([]) },
      overrideAccess: true,
      req: adminReq,
    })

    // Editing the section (exercise unchanged) must not re-add the block.
    await payload.update({
      collection: 'sections',
      id: section.id,
      data: { title: 'Section Renamed' },
      overrideAccess: true,
      req: adminReq,
    })

    const afterEdit = await payload.findByID({
      collection: 'exercises',
      id: exercise.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(parseBlocks(afterEdit.blocks)).toEqual([])
  })

  it('reorder via direct update persists and a hard reload reflects the new order', async () => {
    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: 'Exercise Block Reorder Lesson',
        chapter: chapterId,
        type: 'learning',
        order: 201,
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

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: 'Exercise With Three Sections',
        lesson: lesson.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)

    const a = await payload.create({
      collection: 'sections',
      data: { title: 'A', exercise: exercise.id, order: 1, tenant: tenantId } as any,
      overrideAccess: true,
      req: adminReq,
    })
    const b = await payload.create({
      collection: 'sections',
      data: { title: 'B', exercise: exercise.id, order: 2, tenant: tenantId } as any,
      overrideAccess: true,
      req: adminReq,
    })
    const c = await payload.create({
      collection: 'sections',
      data: { title: 'C', exercise: exercise.id, order: 3, tenant: tenantId } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(a.id, b.id, c.id)

    // Reverse the order via direct blocks update (mirrors the UI reorder).
    const afterCreate = await payload.findByID({
      collection: 'exercises',
      id: exercise.id,
      depth: 0,
      overrideAccess: true,
    })
    const initial = parseBlocks(afterCreate.blocks)
    expect(initial.map((blk) => blk.section)).toEqual([a.id, b.id, c.id])

    const reversed = [...initial].reverse()
    await payload.update({
      collection: 'exercises',
      id: exercise.id,
      data: { blocks: JSON.stringify(reversed) },
      overrideAccess: true,
      req: adminReq,
    })

    // Hard reload — re-fetch the doc to confirm the new order persisted.
    const afterUpdate = await payload.findByID({
      collection: 'exercises',
      id: exercise.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(parseBlocks(afterUpdate.blocks).map((blk) => blk.section)).toEqual([c.id, b.id, a.id])
  })

  it('creating a new section after a delete still auto-appends a sectionRef', async () => {
    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: 'Exercise Block Append Lesson',
        chapter: chapterId,
        type: 'learning',
        order: 202,
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

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: 'Exercise For Append After Delete',
        lesson: lesson.id,
        order: 1,
        tenant: tenantId,
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)

    const first = await payload.create({
      collection: 'sections',
      data: { title: 'First', exercise: exercise.id, order: 1, tenant: tenantId } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(first.id)

    // Admin clears the playlist (simulates UI delete-all).
    await payload.update({
      collection: 'exercises',
      id: exercise.id,
      data: { blocks: JSON.stringify([]) },
      overrideAccess: true,
      req: adminReq,
    })

    // A new section created against the same exercise should still auto-append.
    const second = await payload.create({
      collection: 'sections',
      data: { title: 'Second', exercise: exercise.id, order: 2, tenant: tenantId } as any,
      overrideAccess: true,
      req: adminReq,
    })
    sectionIds.push(second.id)

    const after = await payload.findByID({
      collection: 'exercises',
      id: exercise.id,
      depth: 0,
      overrideAccess: true,
    })
    const blocks = parseBlocks(after.blocks)
    expect(blocks.some((b) => b.section === first.id)).toBe(false)
    expect(blocks.some((b) => b.section === second.id)).toBe(true)
  })
})
