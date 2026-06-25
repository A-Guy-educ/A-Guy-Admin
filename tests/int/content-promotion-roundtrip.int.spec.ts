/**
 * Integration test — content-promotion import via Payload's local API.
 *
 * We don't drive a full export→import round-trip through `exportContent`
 * because the shared test Payload instance accumulates docs from other
 * suites; a full-DB re-import would step on every other test. Instead we
 * exercise the import service against a synthetic minimal bundle that we
 * construct here, which covers the parts that depend on Payload (id
 * preservation via `allowIDOnCreate`, collision detection, reference
 * rewriting, transaction wrapping). Pure-logic coverage of the remap
 * walker lives in tests/unit/content-promotion-id-remap.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { Payload, PayloadRequest } from 'payload'

import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import {
  BUNDLE_MANIFEST_VERSION,
  MANIFEST_FILENAME,
} from '@/server/services/content-promotion/constants'
import { importContent } from '@/server/services/content-promotion/import-content'
import type { BundleManifest } from '@/server/services/content-promotion/types'
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

interface BundleSpec {
  manifest: BundleManifest
}

async function buildBundle(spec: BundleSpec): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(MANIFEST_FILENAME, JSON.stringify(spec.manifest))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

function newId(): string {
  const chars = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * 16)]
  return s
}

describe('Content promotion: import service', () => {
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
    // Shared payload instance — global teardown handles the DB connection.
  })

  it('preserves IDs when no collision on the target', async () => {
    const ts = Date.now()
    const req = mockAdminReq(payload)

    const courseId = newId()
    const chapterId = newId()
    const lessonId = newId()
    const exerciseId = newId()

    const manifest: BundleManifest = {
      version: BUNDLE_MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      source: { serverUrl: 'http://test-source' },
      counts: { media: 0, courses: 1, chapters: 1, lessons: 1, exercises: 1 },
      collections: {
        media: [],
        courses: [
          {
            id: courseId,
            courseLabel: `IMP-${ts}`,
            title: `Imported Course ${ts}`,
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
          // Cast to BundledDoc — manifest accepts passthrough fields.
        ] as BundleManifest['collections']['courses'],
        chapters: [
          {
            id: chapterId,
            title: `Imported Chapter ${ts}`,
            chapterLabel: `ICH-${ts}`,
            course: courseId,
            order: 0,
            status: 'published',
            isActive: true,
            tenant: tenantId,
            locale: 'he',
          },
        ] as BundleManifest['collections']['chapters'],
        lessons: [
          {
            id: lessonId,
            title: `Imported Lesson ${ts}`,
            slug: `imp-lesson-${ts}`,
            chapter: chapterId,
            type: 'practice',
            order: 0,
            status: 'published',
            isActive: true,
            tenant: tenantId,
            locale: 'he',
            accessType: 'inherit',
            contentStatus: 'none',
          },
        ] as BundleManifest['collections']['lessons'],
        exercises: [
          {
            id: exerciseId,
            title: `Imported Ex ${ts}`,
            lesson: lessonId,
            origin: 'manual',
            content: { blocks: [] },
          },
        ] as BundleManifest['collections']['exercises'],
      },
    }

    const buffer = await buildBundle({ manifest })
    const report = await importContent(payload, req, { bundleBuffer: buffer })

    // Track for cleanup before any assertions can throw.
    cleanup.push({ collection: 'exercises', id: exerciseId })
    cleanup.push({ collection: 'lessons', id: lessonId })
    cleanup.push({ collection: 'chapters', id: chapterId })
    cleanup.push({ collection: 'courses', id: courseId })

    expect(report.perCollection.courses.failed).toBe(0)
    expect(report.perCollection.chapters.failed).toBe(0)
    expect(report.perCollection.lessons.failed).toBe(0)
    expect(report.perCollection.exercises.failed).toBe(0)
    expect(Object.keys(report.remappedIds)).toHaveLength(0)

    // The IDs from the bundle were threaded through (allowIDOnCreate works).
    const courseAfter = await payload.findByID({
      collection: 'courses',
      id: courseId,
      depth: 0,
      overrideAccess: true,
    })
    expect(courseAfter.id).toBe(courseId)

    // Reference resolves to the imported chapter — no remap needed.
    const chapterAfter = await payload.findByID({
      collection: 'chapters',
      id: chapterId,
      depth: 1,
      overrideAccess: true,
    })
    const refCourseId =
      typeof chapterAfter.course === 'string' ? chapterAfter.course : chapterAfter.course?.id
    expect(refCourseId).toBe(courseId)
  }, 180000)

  it('generates new IDs and rewrites internal references on collision', async () => {
    const ts = Date.now()
    const req = mockAdminReq(payload)

    // Seed an existing course on the target whose ID matches what the bundle
    // tries to import. The import should treat this as a collision and
    // remap, leaving the seeded doc untouched.
    const existingCourseId = newId()
    const existingCourse = await payload.create({
      collection: 'courses',
      data: {
        id: existingCourseId,
        courseLabel: `SEED-${ts}`,
        title: `Seeded ${ts}`,
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
    cleanup.push({ collection: 'courses', id: existingCourse.id })

    // Bundle contains a course with the same ID, plus a chapter that points
    // at it. After remap the chapter must point at the new (remapped) id.
    const chapterId = newId()
    const manifest: BundleManifest = {
      version: BUNDLE_MANIFEST_VERSION,
      exportedAt: new Date().toISOString(),
      source: { serverUrl: 'http://test-source' },
      counts: { media: 0, courses: 1, chapters: 1, lessons: 0, exercises: 0 },
      collections: {
        media: [],
        courses: [
          {
            id: existingCourseId,
            courseLabel: `BUN-${ts}`,
            title: `Bundle Course ${ts}`,
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
        ] as BundleManifest['collections']['courses'],
        chapters: [
          {
            id: chapterId,
            title: `Bundle Chapter ${ts}`,
            chapterLabel: `BCH-${ts}`,
            course: existingCourseId,
            order: 0,
            status: 'published',
            isActive: true,
            tenant: tenantId,
            locale: 'he',
          },
        ] as BundleManifest['collections']['chapters'],
        lessons: [],
        exercises: [],
      },
    }

    const buffer = await buildBundle({ manifest })
    const report = await importContent(payload, req, { bundleBuffer: buffer })

    const remappedCourseId = report.remappedIds[`courses:${existingCourseId}`]
    expect(remappedCourseId).toBeDefined()
    expect(remappedCourseId).not.toBe(existingCourseId)
    cleanup.push({ collection: 'courses', id: remappedCourseId })
    cleanup.push({ collection: 'chapters', id: chapterId })

    // The seeded course is untouched.
    const seededAfter = await payload.findByID({
      collection: 'courses',
      id: existingCourseId,
      depth: 0,
      overrideAccess: true,
    })
    expect(seededAfter.title).toBe(`Seeded ${ts}`)

    // The bundle's course landed under the remapped id with the bundle's title.
    const importedCourse = await payload.findByID({
      collection: 'courses',
      id: remappedCourseId,
      depth: 0,
      overrideAccess: true,
    })
    expect(importedCourse.title).toBe(`Bundle Course ${ts}`)

    // The bundle's chapter rewrote its `course` ref to the remapped id.
    const chapterAfter = await payload.findByID({
      collection: 'chapters',
      id: chapterId,
      depth: 1,
      overrideAccess: true,
    })
    const refCourseId =
      typeof chapterAfter.course === 'string' ? chapterAfter.course : chapterAfter.course?.id
    expect(refCourseId).toBe(remappedCourseId)
  }, 180000)
})
