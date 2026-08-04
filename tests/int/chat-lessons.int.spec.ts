/**
 * @fileType integration-test
 * @domain chat-lessons
 * @ai-summary Integration tests for the `chat-lessons` collection: happy path,
 *             graph validation (unique stepIds, unknown nextStepId, missing
 *             finish, unreachable step), and the composite lesson+locale
 *             uniqueness index.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'

type StepInput = Record<string, unknown>

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

const validSteps = (): StepInput[] => [
  {
    blockType: 'teacherIntro',
    stepId: 'intro',
    text: 'Welcome!',
    nextStepId: 'q1',
  },
  {
    blockType: 'multipleChoice',
    stepId: 'q1',
    text: 'Pick one',
    options: [
      { text: 'A', isCorrect: true, nextStepId: 'done' },
      { text: 'B', isCorrect: false, nextStepId: 'done' },
    ],
  },
  {
    blockType: 'finish',
    stepId: 'done',
    text: 'Great job!',
  },
]

describe('chat-lessons collection', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let courseId: string
  let chapterId: string
  const lessonIds: string[] = []
  const chatLessonIds: string[] = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    tenantId = await ensureDefaultTenant(payload)
    const ts = Date.now()

    const category = await payload.create({
      collection: 'categories',
      data: {
        title: `Chat Category ${ts}`,
        slug: `chat-category-${ts}`,
        locale: 'he',
      },
      overrideAccess: true,
    })
    categoryId = category.id

    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `CL-${ts}`,
        title: `Chat Course ${ts}`,
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
      overrideAccess: true,
      draft: false,
    })
    courseId = course.id

    const chapter = await payload.create({
      collection: 'chapters',
      data: {
        title: `Chat Chapter ${ts}`,
        chapterLabel: `CL-${ts}`,
        course: courseId,
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
      },
      overrideAccess: true,
    })
    chapterId = chapter.id
  })

  afterAll(async () => {
    for (const id of chatLessonIds) {
      try {
        await payload.delete({ collection: 'chat-lessons', id, overrideAccess: true })
      } catch {
        // ignore
      }
    }
    for (const id of lessonIds) {
      try {
        await payload.delete({ collection: 'lessons', id, overrideAccess: true })
      } catch {
        // ignore
      }
    }
    try {
      await payload.delete({ collection: 'chapters', id: chapterId, overrideAccess: true })
    } catch {
      // ignore
    }
    try {
      await payload.delete({ collection: 'courses', id: courseId, overrideAccess: true })
    } catch {
      // ignore
    }
    try {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    } catch {
      // ignore
    }
    await payload.db?.destroy?.()
  })

  const createLesson = async (order: number): Promise<string> => {
    const lesson = await payload.create({
      collection: 'lessons',
      data: {
        title: `Chat Lesson ${order}-${Date.now()}`,
        topic: 'Test',
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
      },
      overrideAccess: true,
      draft: false,
    })
    lessonIds.push(lesson.id)
    return lesson.id
  }

  it('creates and updates a valid chat script', async () => {
    const lessonId = await createLesson(1)

    const created = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'he',
        highlights: 'Kickoff',
        steps: validSteps() as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(created.id)

    expect(created.steps).toHaveLength(3)
    expect(created.highlights).toBe('Kickoff')

    const updated = await payload.update({
      collection: 'chat-lessons',
      id: created.id,
      data: { highlights: 'Updated' },
      overrideAccess: true,
    })
    expect(updated.highlights).toBe('Updated')
  })

  it('allows a partial update that omits steps', async () => {
    const lessonId = await createLesson(10)

    const created = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'he',
        steps: validSteps() as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(created.id)

    const toggled = await payload.update({
      collection: 'chat-lessons',
      id: created.id,
      data: { isActive: false, status: 'archived' },
      overrideAccess: true,
    })
    expect(toggled.isActive).toBe(false)
    expect(toggled.status).toBe('archived')
    expect(toggled.steps).toHaveLength(3)
  })

  it('trims whitespace on nextStepId references before checking them', async () => {
    const lessonId = await createLesson(11)
    const steps = validSteps()
    ;(steps[0] as StepInput).nextStepId = 'q1 '
    ;(steps[1] as StepInput).options = [
      { text: 'A', isCorrect: true, nextStepId: ' done' },
      { text: 'B', isCorrect: false, nextStepId: 'done' },
    ]

    const created = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'he',
        steps: steps as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(created.id)
    expect(created.steps).toHaveLength(3)
  })

  it('rejects duplicate stepId within the same doc', async () => {
    const lessonId = await createLesson(2)
    const steps = validSteps()
    ;(steps[1] as StepInput).stepId = 'intro'

    await expect(
      payload.create({
        collection: 'chat-lessons',
        data: {
          lesson: lessonId,
          locale: 'he',
          steps: steps as never,
          tenant: tenantId,
          status: 'draft',
          isActive: true,
          contentStatus: 'none',
          contentStatusVisible: true,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Duplicate stepId/)
  })

  it('rejects an unknown nextStepId reference', async () => {
    const lessonId = await createLesson(3)
    const steps = validSteps()
    ;(steps[0] as StepInput).nextStepId = 'does-not-exist'

    await expect(
      payload.create({
        collection: 'chat-lessons',
        data: {
          lesson: lessonId,
          locale: 'he',
          steps: steps as never,
          tenant: tenantId,
          status: 'draft',
          isActive: true,
          contentStatus: 'none',
          contentStatusVisible: true,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/unknown nextStepId/)
  })

  it('rejects a doc with no finish step', async () => {
    const lessonId = await createLesson(4)
    const steps = validSteps().filter((s) => (s as StepInput).blockType !== 'finish')
    ;(steps[1] as StepInput).options = [
      { text: 'A', isCorrect: true },
      { text: 'B', isCorrect: false },
    ]
    delete (steps[0] as StepInput).nextStepId

    await expect(
      payload.create({
        collection: 'chat-lessons',
        data: {
          lesson: lessonId,
          locale: 'he',
          steps: steps as never,
          tenant: tenantId,
          status: 'draft',
          isActive: true,
          contentStatus: 'none',
          contentStatusVisible: true,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/exactly one finish step/)
  })

  it('rejects a doc with an unreachable step', async () => {
    const lessonId = await createLesson(5)
    const steps = validSteps()
    steps.push({
      blockType: 'teacherIntro',
      stepId: 'orphan',
      text: 'nobody references me',
    })

    await expect(
      payload.create({
        collection: 'chat-lessons',
        data: {
          lesson: lessonId,
          locale: 'he',
          steps: steps as never,
          tenant: tenantId,
          status: 'draft',
          isActive: true,
          contentStatus: 'none',
          contentStatusVisible: true,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/Unreachable steps/)
  })

  it('rejects a graded multiple choice with no correct option', async () => {
    const lessonId = await createLesson(6)
    const steps = validSteps()
    ;(steps[1] as StepInput).options = [
      { text: 'A', isCorrect: false, nextStepId: 'done' },
      { text: 'B', isCorrect: false, nextStepId: 'done' },
    ]

    await expect(
      payload.create({
        collection: 'chat-lessons',
        data: {
          lesson: lessonId,
          locale: 'he',
          steps: steps as never,
          tenant: tenantId,
          status: 'draft',
          isActive: true,
          contentStatus: 'none',
          contentStatusVisible: true,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow(/no option marked isCorrect/)
  })

  it('accepts an opinion multiple choice (no options declare isCorrect)', async () => {
    const lessonId = await createLesson(7)
    const steps = validSteps()
    ;(steps[1] as StepInput).options = [
      { text: 'Casual', nextStepId: 'done' },
      { text: 'Strict', nextStepId: 'done' },
    ]

    const created = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'he',
        steps: steps as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(created.id)
    expect(created.steps).toHaveLength(3)
  })

  it('rejects a second script for the same lesson+locale', async () => {
    const lessonId = await createLesson(8)

    const first = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'he',
        steps: validSteps() as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(first.id)

    await expect(
      payload.create({
        collection: 'chat-lessons',
        data: {
          lesson: lessonId,
          locale: 'he',
          steps: validSteps() as never,
          tenant: tenantId,
          status: 'draft',
          isActive: true,
          contentStatus: 'none',
          contentStatusVisible: true,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })

  it('allows a second script for a different locale on the same lesson', async () => {
    const lessonId = await createLesson(9)

    const he = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'he',
        steps: validSteps() as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(he.id)

    const en = await payload.create({
      collection: 'chat-lessons',
      data: {
        lesson: lessonId,
        locale: 'en',
        steps: validSteps() as never,
        tenant: tenantId,
        status: 'draft',
        isActive: true,
        contentStatus: 'none',
        contentStatusVisible: true,
      },
      overrideAccess: true,
    })
    chatLessonIds.push(en.id)

    expect(en.locale).toBe('en')
    expect(he.locale).toBe('he')
  })
})
