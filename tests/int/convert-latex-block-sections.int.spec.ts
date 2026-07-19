/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration tests for the partitioned LaTeX-block conversion flow.
 *
 * Covers issue #238:
 *  (a) Exercise with question blocks → sections created + exercise trimmed
 *      (each section ends with its anchor question, exercise.content.blocks
 *       holds the pre-question shared blocks, exercise.blocks is a sectionRef
 *       playlist in the right order).
 *  (b) Exercise with no question blocks → flat stream stays on
 *      exercise.content.blocks (legacy shape preserved).
 *  (c) Already-sectioned exercise → 422 with the exact error string
 *      `partition only works on empty exercises`.
 *
 * The endpoint is invoked directly via the exported handler, mirroring the
 * pattern used by `full-pipeline.ts` so we don't need a running Next.js
 * server to exercise the partition logic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import type { PayloadRequest } from 'payload'
import { AccountRole } from '@/infra/auth/roles'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import { convertLatexBlockOnExercise } from '@/server/payload/endpoints/exercises/convert-latex-block'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

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
      /* ignore */
    }
  }
  return []
}

function latexBlock(
  latex: string,
  id = `lb-${Math.random().toString(36).slice(2, 10)}`,
): ContentBlock {
  return { id, type: 'latex', latex, renderMode: 'block' }
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
  const stamp = Date.now() + Math.floor(Math.random() * 10_000)
  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: `LBC-${stamp}`,
      title: `LBC Course ${stamp}`,
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
  const chapter = await payload.create({
    collection: 'chapters',
    data: {
      title: `LBC Chapter ${stamp}`,
      chapterLabel: `LBC-${stamp}`,
      course: course.id,
      order: 0,
      status: 'published',
      isActive: true,
      tenant: tenantId,
      locale: 'he',
    } as any,
    overrideAccess: true,
  })
  const lesson = await payload.create({
    collection: 'lessons',
    data: {
      title: `LBC Lesson ${stamp}`,
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
 * Realistic Bagrut-style LaTeX: a `\question` environment with two
 * questions. parseLatexToBlocks is a deterministic script parser that
 * handles this shape end-to-end without AI fallback.
 */
const TWO_QUESTION_LATEX = String.raw`
\begin{questions}
\question Is $2+2=4$?\begin{choices}\choice True \choice False\end{choices}
\question What is $\sqrt{16}$?\begin{choices}\choice 2 \choice 4 \choice 8\end{choices}
\end{questions}
`

/**
 * Flat LaTeX that yields only rich_text blocks (no question_*). parseLatexToBlocks
 * will emit rich_text blocks via the bullet/text fallback paths.
 */
const NO_QUESTION_LATEX = String.raw`Some paragraph text that should become a rich text block.`

describe('convertLatexBlockOnExercise — partition into Sections', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let adminReq: any
  let payloadRequest: PayloadRequest

  const exerciseIds: string[] = []
  const sectionIds: string[] = []
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
        email: `convert-latex-block-sections-${timestamp}@test.local`,
        password: 'test-password-1234',
        name: 'Convert Latex Block Sections',
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

    payloadRequest = {
      payload,
      user: adminUser,
      url: 'http://localhost:3000/api/exercises/convert-latex-block',
      headers: new Headers(),
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const category = await payload.create({
      collection: 'categories',
      data: {
        title: `LBC Category ${timestamp}`,
        slug: `lbc-category-${timestamp}`,
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

  async function seedExerciseWithLatex(latex: string) {
    const hierarchy = await seedHierarchy(payload, tenantId, categoryId)
    courseIds.push(hierarchy.courseId)
    chapterIds.push(hierarchy.chapterId)
    lessonIds.push(hierarchy.lessonId)

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: `LBC Exercise ${Date.now()}`,
        lesson: hierarchy.lessonId,
        order: 1,
        tenant: tenantId,
        content: { blocks: [latexBlock(latex)] },
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)
    return { ...hierarchy, exerciseId: exercise.id }
  }

  it('(a) partitions an exercise with question blocks into N sections + writes the sectionRef playlist', async () => {
    const { exerciseId } = await seedExerciseWithLatex(TWO_QUESTION_LATEX)

    const response = await convertLatexBlockOnExercise(payloadRequest, exerciseId)
    const status = response.status
    const body = await response.json()

    // The endpoint must have succeeded.
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.sectionCount).toBeGreaterThan(0)
    expect(body.data.isFlat).toBe(false)
    expect(body.data.sectionIds.length).toBe(body.data.sectionCount)

    const createdSectionIds: string[] = body.data.sectionIds
    sectionIds.push(...createdSectionIds)

    // Verify the parent exercise was trimmed: content.blocks holds the
    // pre-question shared blocks (or a single rich_text placeholder if none).
    const exercise = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
    })
    const sharedBlocks = ((exercise.content as any)?.blocks ?? []) as ContentBlock[]
    expect(Array.isArray(sharedBlocks)).toBe(true)
    // No question_* blocks should remain on the exercise — they've moved into sections.
    expect(sharedBlocks.some((b) => b.type.startsWith('question_'))).toBe(false)

    // exercise.blocks is a JSON playlist of sectionRef entries matching the
    // returned sectionIds order.
    const playlist = parseBlocks(exercise.blocks)
    expect(playlist.length).toBe(createdSectionIds.length)
    playlist.forEach((entry, idx) => {
      expect(entry.blockType).toBe('sectionRef')
      expect(entry.section).toBe(createdSectionIds[idx])
    })

    // Each created section ends with its anchor question block.
    const sections = await payload.find({
      collection: 'sections',
      where: { id: { in: createdSectionIds } },
      depth: 0,
      overrideAccess: true,
    })
    for (const section of sections.docs) {
      const sectionBlocks = ((section.content as any)?.blocks ?? []) as ContentBlock[]
      expect(sectionBlocks.length).toBeGreaterThan(0)
      const last = sectionBlocks[sectionBlocks.length - 1]
      expect(last.type).toMatch(/^question_/)
    }
  }, 120_000)

  it('(b) leaves exercise.content.blocks flat when no question blocks are produced', async () => {
    const { exerciseId } = await seedExerciseWithLatex(NO_QUESTION_LATEX)

    const response = await convertLatexBlockOnExercise(payloadRequest, exerciseId)
    const status = response.status
    const body = await response.json()

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.isFlat).toBe(true)
    expect(body.data.sectionCount).toBe(0)

    // No sections should have been created.
    const exercise = await payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
    })
    expect(
      exercise.blocks === null || exercise.blocks === undefined || exercise.blocks === '',
    ).toBe(true)

    // Flat stream is preserved on exercise.content.blocks (legacy shape).
    const blocks = ((exercise.content as any)?.blocks ?? []) as ContentBlock[]
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks.length).toBeGreaterThan(0)
  }, 120_000)

  it('(c) refuses with HTTP 422 and the exact error string when the exercise is already sectioned', async () => {
    // Seed an exercise that already has a sectionRef playlist.
    const hierarchy = await seedHierarchy(payload, tenantId, categoryId)
    courseIds.push(hierarchy.courseId)
    chapterIds.push(hierarchy.chapterId)
    lessonIds.push(hierarchy.lessonId)

    const exercise = await payload.create({
      collection: 'exercises',
      data: {
        title: `LBC Pre-sectioned ${Date.now()}`,
        lesson: hierarchy.lessonId,
        order: 1,
        tenant: tenantId,
        content: { blocks: [latexBlock(TWO_QUESTION_LATEX)] },
      } as any,
      overrideAccess: true,
      req: adminReq,
    })
    exerciseIds.push(exercise.id)

    // First conversion succeeds and partitions the exercise.
    const first = await convertLatexBlockOnExercise(payloadRequest, exercise.id)
    const firstBody = await first.json()
    expect(first.status).toBe(200)
    expect(firstBody.success).toBe(true)
    sectionIds.push(...firstBody.data.sectionIds)

    // Second conversion must refuse with the exact error string and 422.
    const second = await convertLatexBlockOnExercise(payloadRequest, exercise.id)
    const secondBody = await second.json()
    expect(second.status).toBe(422)
    expect(secondBody.success).toBe(false)
    expect(secondBody.error).toBe('partition only works on empty exercises')
  }, 120_000)
})
