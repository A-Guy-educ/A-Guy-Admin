/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration tests: Exercises `afterRead` aggregator that flattens child
 * section blocks into `exercise.content.blocks`.
 *
 * Covers issue #172 — read-time compatibility shim for the sibling
 * A-Guy-Web repo, which still reads `exercise.content.blocks` in ~6 places
 * and does not yet know about sections.
 *
 * Test order matters: sections must be created BEFORE we empty out the
 * exercise's own `content.blocks`. The Sections `afterChange` hook calls
 * `payload.update` on the parent exercise to write its sectionRef into the
 * playlist, and that update re-runs Zod validation on `content` — so the
 * exercise still needs its default content at the moment a section is
 * created. We empty the content via a direct Mongo write AFTER the
 * playlist is populated, mirroring the production path (e.g. a future
 * migration that empties `content.blocks` for exercises whose content
 * lives entirely in sections).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import { startMongoContainer, stopMongoContainer } from '@/infra/utils/test/mongodb-container'
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

function makeBlocks(entries: BlockEntry[]): string {
  return JSON.stringify(entries)
}

function readContentBlocks(doc: { content?: unknown }): unknown[] {
  const content = doc.content as { blocks?: unknown } | undefined
  return Array.isArray(content?.blocks) ? (content!.blocks as unknown[]) : []
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
      courseLabel: `A-${timestamp}`,
      title: `Aggregator Course ${timestamp}`,
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
      title: `Aggregator Chapter ${timestamp}`,
      chapterLabel: `A-${timestamp}`,
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
      title: `Aggregator Lesson ${timestamp}`,
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

/**
 * The exercise `content` JSON field is Zod-validated as
 * `z.object({ blocks: z.array(...).min(1) })`, so a `{ blocks: [] }` payload
 * is rejected at create/update. The aggregator's primary use case is exactly
 * that shape (an exercise whose content has been moved into sections), so we
 * set the doc into that state with a direct Mongo write that bypasses
 * Payload validation. This mirrors the production path.
 */
async function setExerciseContentDirectly(
  payload: Payload,
  exerciseId: string,
  content: unknown,
): Promise<void> {
  const { ObjectId } = await import('mongodb')
  const coll = payload.db.collections['exercises'] as { updateOne: Function }
  await coll.updateOne({ _id: new ObjectId(exerciseId) }, { $set: { content } })
}

interface SeededSection {
  id: string
  order: number
  blocks: { id: string; type: string; value: string }[]
}

interface SectionSeed extends Omit<SeededSection, 'id'> {}

describe('Exercises afterRead aggregator (#172)', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let adminReq: any

  const sectionIds: string[] = []
  const exerciseIds: string[] = []
  const lessonIds: string[] = []
  const chapterIds: string[] = []
  const courseIds: string[] = []

  let originalDatabaseUrl: string | undefined

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL
    // @ts-expect-error: TypeScript doesn't allow delete on process.env
    delete process.env.DATABASE_URL

    const mongoUri = await startMongoContainer()
    process.env.DATABASE_URL = mongoUri

    const config = await import('@payload-config')
    payload = await getPayload({ config: config.default })
    tenantId = await ensureDefaultTenant(payload)
    const timestamp = Date.now()

    const admin = await payload.create({
      collection: 'users',
      data: {
        email: `aggregator-admin-${timestamp}@test.local`,
        password: 'test-password-1234',
        name: 'Aggregator Admin',
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
        title: `Aggregator Category ${timestamp}`,
        slug: `aggregator-category-${timestamp}`,
        locale: 'he',
      },
    })
    categoryId = category.id
  }, 180_000)

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
    if (payload?.db?.destroy) await payload.db.destroy()
    await stopMongoContainer()

    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl
    } else {
      // @ts-expect-error: TypeScript doesn't allow delete on process.env
      delete process.env.DATABASE_URL
    }
  }, 180_000)

  async function seedExerciseWithHierarchy() {
    const hierarchy = await seedHierarchy(payload, tenantId, categoryId)
    courseIds.push(hierarchy.courseId)
    chapterIds.push(hierarchy.chapterId)
    lessonIds.push(hierarchy.lessonId)

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: `Aggregator Exercise ${Date.now()}`,
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

  async function createSectionsFor(
    exerciseId: string,
    sections: SectionSeed[],
  ): Promise<SeededSection[]> {
    const created: SeededSection[] = []
    for (const section of sections) {
      const doc = await payload.create({
        collection: 'sections',
        data: {
          title: `Sec ${section.order}`,
          exercise: exerciseId,
          order: section.order,
          tenant: tenantId,
          content: {
            blocks: section.blocks.map((b) => ({
              id: b.id,
              type: b.type,
              format: 'md-math-v1',
              value: b.value,
              mediaIds: [],
            })),
          },
        } as any,
        overrideAccess: true,
        req: adminReq,
      })
      sectionIds.push(doc.id)
      created.push({ id: doc.id, order: section.order, blocks: section.blocks })
    }
    return created
  }

  it('aggregates child section blocks when the exercise has empty content.blocks', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()
    // Create sections FIRST so the sectionRef playlist gets written while
    // the exercise's content is still default-valid.
    await createSectionsFor(exerciseId, [
      { order: 1, blocks: [{ id: 's-a-1', type: 'rich_text', value: 'Section A intro' }] },
      { order: 2, blocks: [{ id: 's-b-1', type: 'rich_text', value: 'Section B intro' }] },
    ])

    // Now empty the content so the aggregator has work to do.
    await setExerciseContentDirectly(payload, exerciseId, { blocks: [] })

    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: adminReq,
    })

    const blocks = readContentBlocks(read)
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as { id?: string }).id).toBe('s-a-1')
    expect((blocks[1] as { id?: string }).id).toBe('s-b-1')

    // The on-disk content was NOT mutated by the read — it stays empty.
    const flagReq: any = { user: adminReq.user, context: {} }
    markRequestAsContentPromotionImport(flagReq)
    const raw = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: flagReq,
    })
    expect(readContentBlocks(raw)).toEqual([])
  })

  it('returns legacy blocks unchanged when content.blocks is non-empty (no aggregation)', async () => {
    const legacyBlock = {
      id: 'legacy-1',
      type: 'rich_text',
      format: 'md-math-v1',
      value: 'Legacy body',
      mediaIds: [],
    }
    const { exerciseId } = await seedExerciseWithHierarchy()
    // Create a section first (so the playlist exists), then set legacy
    // content directly so the hook sees non-empty content.blocks and
    // short-circuits.
    await createSectionsFor(exerciseId, [
      { order: 1, blocks: [{ id: 'ignored-1', type: 'rich_text', value: 'Should not show up' }] },
    ])
    await setExerciseContentDirectly(payload, exerciseId, { blocks: [legacyBlock] })

    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: adminReq,
    })

    const blocks = readContentBlocks(read)
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { id?: string }).id).toBe('legacy-1')
  })

  it('leaves the exercise unchanged when it has no sections and non-empty content.blocks', async () => {
    const originalBlock = {
      id: 'solo-1',
      type: 'rich_text',
      format: 'md-math-v1',
      value: 'Standalone body',
      mediaIds: [],
    }
    const { exerciseId } = await seedExerciseWithHierarchy()
    await setExerciseContentDirectly(payload, exerciseId, { blocks: [originalBlock] })

    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: adminReq,
    })

    const blocks = readContentBlocks(read)
    expect(blocks).toEqual([originalBlock])
  })

  it('aggregates sections in the order dictated by the sectionRef playlist in exercise.blocks', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()
    const created = await createSectionsFor(exerciseId, [
      // Sections in non-natural order (Z, Y, X) — the section.order
      // field is set to 3, 2, 1 to make sure we are NOT just trusting that.
      { order: 3, blocks: [{ id: 'z-1', type: 'rich_text', value: 'Z block' }] },
      { order: 2, blocks: [{ id: 'y-1', type: 'rich_text', value: 'Y block' }] },
      { order: 1, blocks: [{ id: 'x-1', type: 'rich_text', value: 'X block' }] },
    ])
    const [sectionZ, sectionY, sectionX] = created

    // Force the playlist to be: X, Z, Y (not the natural order).
    await payload.update({
      collection: 'exercises',
      id: exerciseId,
      data: {
        blocks: makeBlocks([
          { id: 'pl-x', blockType: 'sectionRef', section: sectionX.id },
          { id: 'pl-z', blockType: 'sectionRef', section: sectionZ.id },
          { id: 'pl-y', blockType: 'sectionRef', section: sectionY.id },
        ]),
      } as any,
      overrideAccess: true,
      req: adminReq,
    })

    await setExerciseContentDirectly(payload, exerciseId, { blocks: [] })

    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: adminReq,
    })

    const blocks = readContentBlocks(read)
    expect(blocks.map((b) => (b as { id?: string }).id)).toEqual(['x-1', 'z-1', 'y-1'])

    // Sanity: the playlist was preserved as written.
    const playlist = parseBlocks(read.blocks)
    expect(playlist.map((e) => e.section)).toEqual([sectionX.id, sectionZ.id, sectionY.id])
  })

  it('falls back to section.order when the sectionRef playlist is missing or empty', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()
    await createSectionsFor(exerciseId, [
      { order: 2, blocks: [{ id: 'o2', type: 'rich_text', value: 'two' }] },
      { order: 1, blocks: [{ id: 'o1', type: 'rich_text', value: 'one' }] },
    ])

    // Clear the playlist to force the fallback path. The empty-string
    // playlist is what the spec describes as "missing or empty".
    await setExerciseContentDirectly(payload, exerciseId, { blocks: [] })
    const { ObjectId } = await import('mongodb')
    const coll = payload.db.collections['exercises'] as { updateOne: Function }
    await coll.updateOne({ _id: new ObjectId(exerciseId) }, { $set: { blocks: '' } })

    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: adminReq,
    })

    const blocks = readContentBlocks(read)
    expect(blocks.map((b) => (b as { id?: string }).id)).toEqual(['o1', 'o2'])
  })

  it('is a no-op when no user is on the request (build/seed)', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()
    await createSectionsFor(exerciseId, [
      { order: 1, blocks: [{ id: 'nu-1', type: 'rich_text', value: 'no user' }] },
    ])
    await setExerciseContentDirectly(payload, exerciseId, { blocks: [] })

    // No `user` on the request — build/seed style.
    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
    })

    expect(readContentBlocks(read)).toEqual([])
  })

  it('is a no-op when the request is flagged as a content-promotion import', async () => {
    const { exerciseId } = await seedExerciseWithHierarchy()
    await createSectionsFor(exerciseId, [
      { order: 1, blocks: [{ id: 'im-1', type: 'rich_text', value: 'imported' }] },
    ])
    await setExerciseContentDirectly(payload, exerciseId, { blocks: [] })

    const importReq: any = { user: adminReq.user, context: {} }
    markRequestAsContentPromotionImport(importReq)

    const read = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: importReq,
    })

    expect(readContentBlocks(read)).toEqual([])
  })
})
