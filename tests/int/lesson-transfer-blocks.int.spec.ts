// @vitest-environment node
// Node.js environment required: payload.login() uses jose JWT signing.

/**
 * Integration tests: POST /api/lessons/transfer-blocks
 *
 * Guards the bulk-transfer flow:
 *   - exercise.lesson flips to target
 *   - source.blocks loses the moved refs (filtered)
 *   - target.blocks gains them (appended, no duplicates against existing)
 *   - _skipBlockSync context prevents the per-doc sync hooks from touching
 *     lesson.blocks (we rewrite in bulk after the ref loop)
 *   - Zod rejects duplicate (blockType, refId) tuples and source === target
 *
 * Pattern mirrors tests/int/admin-dashboard-metrics.int.spec.ts: shared
 * Payload from global-int-setup, imports POST directly, auths via
 * `Authorization: JWT <token>`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { POST } from '@/app/api/lessons/transfer-blocks/route'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import config from '@payload-config'
import { NextRequest } from 'next/server'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const hasDatabaseUrl = !!process.env.DATABASE_URL

interface BlockEntry {
  id: string
  blockType: 'exerciseRef' | 'contentPageRef'
  exercise?: string
  contentPage?: string
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
  if (existing.docs[0]) return existing.docs[0].id as string
  const created = await payload.create({
    collection: 'tenants',
    data: { name: slug, slug, status: 'active' } as any,
    overrideAccess: true,
  })
  return created.id as string
}

let payload: Payload
let adminToken: string
let adminUserId: string
let tenantId: string
let categoryId: string
let courseId: string
let chapterId: string
let sourceLessonId: string
let targetLessonId: string
const exerciseIdsToCleanup: string[] = []
const lessonIdsToCleanup: string[] = []

const ts = Date.now()

beforeAll(async () => {
  if (!hasDatabaseUrl) return

  payload = await getPayload({ config })
  tenantId = await ensureDefaultTenant(payload)

  const adminEmail = `transfer-blocks-admin-${ts}@test.local`
  const password = 'test-password-1234'

  const admin = await payload.create({
    collection: 'users',
    data: { email: adminEmail, password, name: 'Transfer Admin' } as any,
  })
  await payload.update({
    collection: 'users',
    id: admin.id,
    data: { role: AccountRole.Admin } as any,
    overrideAccess: true,
  })
  adminUserId = admin.id as string

  const adminLogin = await payload.login({
    collection: 'users',
    data: { email: adminEmail, password },
  })
  adminToken = adminLogin.token!

  const category = await payload.create({
    collection: 'categories',
    data: {
      title: `Transfer Category ${ts}`,
      slug: `transfer-category-${ts}`,
      locale: 'he',
    } as any,
    overrideAccess: true,
  })
  categoryId = category.id as string

  const course = await payload.create({
    collection: 'courses',
    data: {
      courseLabel: `TB-${ts}`,
      title: `Transfer Course ${ts}`,
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
    overrideAccess: true,
    draft: false,
  })
  courseId = course.id as string

  const chapter = await payload.create({
    collection: 'chapters',
    data: {
      title: `Transfer Chapter ${ts}`,
      chapterLabel: `TB-${ts}`,
      course: courseId,
      order: 0,
      status: 'published',
      isActive: true,
      tenant: tenantId,
      locale: 'he',
    } as any,
    overrideAccess: true,
  })
  chapterId = chapter.id as string
}, 120_000)

afterAll(async () => {
  if (!hasDatabaseUrl || !payload) return
  for (const id of exerciseIdsToCleanup) {
    try {
      await payload.delete({ collection: 'exercises', id, overrideAccess: true })
    } catch {
      /* ignore */
    }
  }
  for (const id of lessonIdsToCleanup) {
    try {
      await payload.delete({ collection: 'lessons', id, overrideAccess: true })
    } catch {
      /* ignore */
    }
  }
  for (const [collection, id] of [
    ['chapters', chapterId],
    ['courses', courseId],
    ['categories', categoryId],
    ['users', adminUserId],
  ] as const) {
    if (!id) continue
    try {
      await payload.delete({ collection, id, overrideAccess: true })
    } catch {
      /* ignore */
    }
  }
}, 120_000)

async function createLesson(label: string, order: number): Promise<string> {
  const lesson = await payload.create({
    collection: 'lessons',
    data: {
      title: `Transfer Lesson ${label} ${ts}`,
      chapter: chapterId,
      type: 'learning',
      order,
      status: 'published',
      isActive: true,
      tenant: tenantId,
      locale: 'he',
      accessType: 'inherit',
      contentStatus: 'none',
      contentStatusVisible: true,
    } as any,
    overrideAccess: true,
    draft: false,
  })
  lessonIdsToCleanup.push(lesson.id as string)
  return lesson.id as string
}

async function createExercise(lessonId: string, title: string, order: number): Promise<string> {
  const ex = await payload.create({
    collection: 'exercises',
    data: { title, lesson: lessonId, order, tenant: tenantId } as any,
    overrideAccess: true,
    draft: true,
  })
  exerciseIdsToCleanup.push(ex.id as string)
  return ex.id as string
}

function makeRequest(body: unknown, token: string | null = adminToken): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `JWT ${token}`
  return new NextRequest('http://localhost:3000/api/lessons/transfer-blocks', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe.skipIf(!hasDatabaseUrl)('POST /api/lessons/transfer-blocks', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await POST(
      makeRequest(
        {
          sourceLessonId: 'x',
          targetLessonId: 'y',
          refs: [{ refId: 'a', blockType: 'exerciseRef' }],
        },
        null,
      ),
    )
    expect(res.status).toBe(401)
  })

  it('rejects duplicate (blockType, refId) tuples via Zod', async () => {
    sourceLessonId = sourceLessonId || (await createLesson('src-dup', 1))
    targetLessonId = targetLessonId || (await createLesson('tgt-dup', 2))
    const res = await POST(
      makeRequest({
        sourceLessonId,
        targetLessonId,
        refs: [
          { refId: 'same-id', blockType: 'exerciseRef' },
          { refId: 'same-id', blockType: 'exerciseRef' },
        ],
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(JSON.stringify(body)).toMatch(/unique/i)
  })

  it('rejects source === target via Zod', async () => {
    sourceLessonId = sourceLessonId || (await createLesson('src-same', 3))
    const res = await POST(
      makeRequest({
        sourceLessonId,
        targetLessonId: sourceLessonId,
        refs: [{ refId: 'r1', blockType: 'exerciseRef' }],
      }),
    )
    expect(res.status).toBe(400)
  })

  it(
    'moves exercise refs: flips exercise.lesson, prunes source.blocks, appends to target.blocks',
    { timeout: 60_000 },
    async () => {
      const src = await createLesson('src-happy', 10)
      const tgt = await createLesson('tgt-happy', 11)
      const keepId = await createExercise(src, 'Keep', 1)
      const moveA = await createExercise(src, 'Move A', 2)
      const moveB = await createExercise(src, 'Move B', 3)

      // Confirm the sync hooks populated source.blocks on exercise create.
      const beforeSrc = await payload.findByID({
        collection: 'lessons',
        id: src,
        depth: 0,
        overrideAccess: true,
      })
      const beforeSrcBlocks = parseBlocks(beforeSrc.blocks)
      expect(beforeSrcBlocks.some((b) => b.exercise === moveA)).toBe(true)
      expect(beforeSrcBlocks.some((b) => b.exercise === moveB)).toBe(true)

      const res = await POST(
        makeRequest({
          sourceLessonId: src,
          targetLessonId: tgt,
          refs: [
            { refId: moveA, blockType: 'exerciseRef' },
            { refId: moveB, blockType: 'exerciseRef' },
          ],
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.transferred).toBe(2)
      expect(body.data.failed).toBe(0)
      expect(body.data.needsReload).toBe(false)

      // exercise.lesson flipped
      const [exMoveA, exMoveB, exKeep] = await Promise.all([
        payload.findByID({ collection: 'exercises', id: moveA, depth: 0, overrideAccess: true }),
        payload.findByID({ collection: 'exercises', id: moveB, depth: 0, overrideAccess: true }),
        payload.findByID({ collection: 'exercises', id: keepId, depth: 0, overrideAccess: true }),
      ])
      const lessonId = (ex: any) => (typeof ex.lesson === 'string' ? ex.lesson : ex.lesson?.id)
      expect(lessonId(exMoveA)).toBe(tgt)
      expect(lessonId(exMoveB)).toBe(tgt)
      expect(lessonId(exKeep)).toBe(src)

      // source.blocks lost the moved refs
      const afterSrc = await payload.findByID({
        collection: 'lessons',
        id: src,
        depth: 0,
        overrideAccess: true,
      })
      const afterSrcBlocks = parseBlocks(afterSrc.blocks)
      expect(afterSrcBlocks.some((b) => b.exercise === moveA)).toBe(false)
      expect(afterSrcBlocks.some((b) => b.exercise === moveB)).toBe(false)
      expect(afterSrcBlocks.some((b) => b.exercise === keepId)).toBe(true)

      // target.blocks gained them
      const afterTgt = await payload.findByID({
        collection: 'lessons',
        id: tgt,
        depth: 0,
        overrideAccess: true,
      })
      const afterTgtBlocks = parseBlocks(afterTgt.blocks)
      expect(afterTgtBlocks.some((b) => b.exercise === moveA)).toBe(true)
      expect(afterTgtBlocks.some((b) => b.exercise === moveB)).toBe(true)
    },
  )

  it(
    'does not duplicate refs that already exist in target.blocks',
    { timeout: 60_000 },
    async () => {
      const src = await createLesson('src-dedup', 20)
      const tgt = await createLesson('tgt-dedup', 21)
      const dupExerciseId = await createExercise(src, 'Will Dup', 1)

      // Seed target.blocks with a pre-existing entry for dupExerciseId.
      // (Simulates the admin manually putting the ref in both lessons.)
      const seed: BlockEntry[] = [
        {
          id: 'preexisting-block-id',
          blockType: 'exerciseRef',
          exercise: dupExerciseId,
        },
      ]
      await payload.update({
        collection: 'lessons',
        id: tgt,
        data: { blocks: JSON.stringify(seed) } as any,
        overrideAccess: true,
      })

      const res = await POST(
        makeRequest({
          sourceLessonId: src,
          targetLessonId: tgt,
          refs: [{ refId: dupExerciseId, blockType: 'exerciseRef' }],
        }),
      )
      expect(res.status).toBe(200)

      const afterTgt = await payload.findByID({
        collection: 'lessons',
        id: tgt,
        depth: 0,
        overrideAccess: true,
      })
      const afterTgtBlocks = parseBlocks(afterTgt.blocks)
      const matches = afterTgtBlocks.filter(
        (b) => b.blockType === 'exerciseRef' && b.exercise === dupExerciseId,
      )
      expect(matches).toHaveLength(1)
    },
  )
})
