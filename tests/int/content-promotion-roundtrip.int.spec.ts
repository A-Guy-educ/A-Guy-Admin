/**
 * Integration test — content-promotion export → import round-trip via the
 * Payload local API. Skips media binaries (no Vercel Blob in tests) by using
 * type='external' media records, which exercise the same code paths without
 * needing a blob store.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload, PayloadRequest } from 'payload'

import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import { exportContent } from '@/server/services/content-promotion/export-content'
import { importContent } from '@/server/services/content-promotion/import-content'
import { getSharedPayload } from '../setup/shared-payload'

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

function mockAdminReq(payload: Payload): PayloadRequest {
  return {
    payload,
    user: { id: 'admin', role: 'admin', collection: 'users' },
    url: 'http://localhost/content-promotion/test',
    headers: new Headers(),
    routeParams: {},
    context: {},
  } as unknown as PayloadRequest
}

describe('Content promotion: export → import round-trip', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  const cleanup: Array<{ collection: string; id: string }> = []

  beforeAll(async () => {
    payload = await getSharedPayload()
    tenantId = await ensureDefaultTenant(payload)

    const ts = Date.now()
    const category = await payload.create({
      collection: 'categories',
      data: { title: `CP-Cat ${ts}`, slug: `cp-cat-${ts}`, locale: 'he' },
      overrideAccess: true,
    })
    categoryId = category.id
  }, 180000)

  afterAll(async () => {
    for (const item of cleanup.reverse()) {
      try {
        await payload.delete({
          collection: item.collection as Parameters<typeof payload.delete>[0]['collection'],
          id: item.id,
          overrideAccess: true,
        })
      } catch {
        // ignore — best-effort cleanup
      }
    }
    try {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    } catch {
      // ignore
    }
    // Don't destroy the DB connection — it's shared across the suite via
    // getSharedPayload() and the global teardown handles cleanup.
  })

  it('exports a tree on collision-free target and imports it preserving IDs', async () => {
    const ts = Date.now()
    const req = mockAdminReq(payload)

    // Create a source-side content tree.
    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `CP-${ts}`,
        title: `Course ${ts}`,
        locale: 'he',
        categories: [categoryId],
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        pageAccessType: 'free',
        accessType: 'free',
        contentStatus: 'none',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'courses', id: course.id })

    const chapter = await payload.create({
      collection: 'chapters',
      data: {
        title: `Chapter ${ts}`,
        chapterLabel: `CH-${ts}`,
        course: course.id,
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'chapters', id: chapter.id })

    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: `Lesson ${ts}`,
        slug: `cp-lesson-${ts}`,
        chapter: chapter.id,
        type: 'practice',
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
        accessType: 'inherit',
        contentStatus: 'none',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'lessons', id: lesson.id })

    const exercise = await payload.create({
      collection: 'exercises',
      data: { title: `Ex ${ts}`, lesson: lesson.id, origin: 'manual' },
      overrideAccess: true,
      draft: true,
    })
    cleanup.push({ collection: 'exercises', id: exercise.id })

    // Export
    const { zipBuffer, report } = await exportContent(payload, req)
    expect(report.counts.courses).toBeGreaterThanOrEqual(1)
    expect(report.counts.exercises).toBeGreaterThanOrEqual(1)

    // Delete the tree so import doesn't collide on _these_ IDs.
    await payload.delete({ collection: 'exercises', id: exercise.id, overrideAccess: true })
    await payload.delete({ collection: 'lessons', id: lesson.id, overrideAccess: true })
    await payload.delete({ collection: 'chapters', id: chapter.id, overrideAccess: true })
    await payload.delete({ collection: 'courses', id: course.id, overrideAccess: true })

    // Drop cleanup entries — IDs we just deleted (or any remap, which gets
    // added below) need to be handled fresh.
    cleanup.length = 0

    // Import
    const importReport = await importContent(payload, req, { bundleBuffer: zipBuffer })

    // The deleted IDs no longer collide, so the original IDs are preserved.
    const courseAfter = await payload.findByID({
      collection: 'courses',
      id: course.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(courseAfter.id).toBe(course.id)
    cleanup.push({ collection: 'courses', id: course.id })

    const chapterAfter = await payload.findByID({
      collection: 'chapters',
      id: chapter.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(chapterAfter.id).toBe(chapter.id)
    cleanup.push({ collection: 'chapters', id: chapter.id })

    const lessonAfter = await payload.findByID({
      collection: 'lessons',
      id: lesson.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(lessonAfter.id).toBe(lesson.id)
    cleanup.push({ collection: 'lessons', id: lesson.id })

    const exerciseAfter = await payload.findByID({
      collection: 'exercises',
      id: exercise.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(exerciseAfter.id).toBe(exercise.id)
    cleanup.push({ collection: 'exercises', id: exercise.id })

    // No IDs needed remapping in the collision-free path.
    expect(Object.keys(importReport.remappedIds).length).toBe(0)
    expect(importReport.perCollection.courses.failed).toBe(0)
    expect(importReport.perCollection.lessons.failed).toBe(0)
    expect(importReport.perCollection.exercises.failed).toBe(0)
  }, 180000)

  it('safe-clones into the same DB without overwriting on ID collision', async () => {
    const ts = Date.now()
    const req = mockAdminReq(payload)

    // Create a single course to export.
    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `CPC-${ts}`,
        title: `Original Title ${ts}`,
        locale: 'he',
        categories: [categoryId],
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        pageAccessType: 'free',
        accessType: 'free',
        contentStatus: 'none',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'courses', id: course.id })

    // Export the bundle.
    const { zipBuffer } = await exportContent(payload, req)

    // Re-import into the *same* DB — every ID collides, so import must
    // generate fresh IDs instead of clobbering the originals.
    const importReport = await importContent(payload, req, { bundleBuffer: zipBuffer })

    // Original course must still exist with its original title.
    const original = await payload.findByID({
      collection: 'courses',
      id: course.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(original.title).toBe(`Original Title ${ts}`)

    // At least one collision was remapped (likely the course we just created).
    const remappedKey = `courses:${course.id}`
    const newCourseId = importReport.remappedIds[remappedKey]
    expect(newCourseId).toBeDefined()
    expect(newCourseId).not.toBe(course.id)
    cleanup.push({ collection: 'courses', id: newCourseId })

    // Both originals and clones now coexist.
    const clone = await payload.findByID({
      collection: 'courses',
      id: newCourseId,
      depth: 0,
      overrideAccess: true,
    })
    expect(clone.title).toBe(`Original Title ${ts}`)
  }, 180000)
})
