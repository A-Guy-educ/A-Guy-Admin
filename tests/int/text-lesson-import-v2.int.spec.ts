/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * End-to-end integration test for the v2 (bracketed / geometry-aware) text
 * lesson importer. Seeds the required category/course/chapter, then runs
 * `importTextLessonFromFile` against a minimal v2 sample and verifies:
 *   - the lesson is created (title derives from filename),
 *   - each exercise gets its own doc with the expected shared blocks
 *     (intro rich_text + standalone question_geometry for the drawing),
 *   - each section becomes its own doc whose block stream is either a
 *     question_select with `attachment.kind = 'geometry'` (MCQ) or a
 *     question_free_response for Open Ended prompts,
 *   - the lesson.blocks playlist references the created exercises.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import type { PayloadRequest } from 'payload'
import { AccountRole } from '@/infra/auth/roles'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'
import { importTextLessonFromFile } from '@/server/services/text-lesson-import/import-text-lesson'

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

const SEP = '='.repeat(40)

// v2 fixture: one exercise with a shared drawing, one MCQ section that
// re-uses the drawing, one Open Ended section that carries its own geometry.
// Kept small on purpose — the parser is already covered by unit tests, this
// spec exists to prove the end-to-end DB write path works.
const V2_LESSON_TEXT = [
  SEP,
  '[ תרגיל 1 - נתוני פתיחה ]',
  SEP,
  '* טקסט: שני ישרים נחתכים בנקודה O.',
  '* שרטוט בסיס (מבנה אובייקטים):',
  '  --- נקודות ---',
  '  * נקודה A | מיקום: X=50, Y=50 | מיקום תווית: שמאל-למעלה | מוצגת: כן',
  '  * נקודה B | מיקום: X=350, Y=350 | מיקום תווית: ימין-למטה | מוצגת: כן',
  '  * נקודה O | מיקום: X=200, Y=200 | מיקום תווית: מימין | מוצגת: כן',
  '  --- ישרים וקטעים ---',
  '  * קטע AB | מנקודה A לנקודה B | צבע: כחול',
  '',
  SEP,
  "[ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]",
  SEP,
  '* סוג השאלה: Single Choice',
  '* הנחיה: מהו הקשר בין הזוויות?',
  '* שרטוט מותאם לסעיף:',
  '  --- נקודות ---',
  '  * נקודה A | מיקום: X=50, Y=50',
  '  * נקודה O | מיקום: X=200, Y=200',
  '  * נקודה C | מיקום: X=50, Y=350',
  '  --- זוויות לתצוגה ---',
  '  * זווית AOC | קודקוד: O | נמדדת בין: OA ל- OC | צבע: אדום | רדיוס: 30',
  '* אפשרות 1: זוויות קודקודיות [תשובה נכונה]',
  '* אפשרות 2: זוויות צמודות',
  '',
  SEP,
  "[ תרגיל 1 - סעיף ב' - שאלה פתוחה ]",
  SEP,
  '* סוג השאלה: Open Ended',
  '* הנחיה: הסבירו במילים שלכם.',
].join('\n')

describe('text-lesson-import v2 — end-to-end', () => {
  let payload: Payload
  let tenantId: string
  let categoryId: string
  let chapterId: string
  let courseId: string
  let lessonId: string
  let payloadRequest: PayloadRequest
  const exerciseIds: string[] = []
  const sectionIds: string[] = []

  beforeAll(async () => {
    payload = await getPayload({ config })
    tenantId = await ensureDefaultTenant(payload)
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const admin = await payload.create({
      collection: 'users',
      data: {
        email: `text-import-v2-${stamp}@test.local`,
        password: 'test-password-1234',
        name: 'Text Import V2',
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

    payloadRequest = {
      payload,
      user: adminUser,
      url: 'http://localhost:3000/api/lessons/import-from-text',
      headers: new Headers(),
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const category = await payload.create({
      collection: 'categories',
      data: {
        title: `TIV2 Category ${stamp}`,
        slug: `tiv2-category-${stamp}`,
        locale: 'he',
      },
    })
    categoryId = category.id

    const course = await payload.create({
      collection: 'courses',
      data: {
        courseLabel: `TIV2-${stamp}`,
        title: `TIV2 Course ${stamp}`,
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
    courseId = course.id

    const chapter = await payload.create({
      collection: 'chapters',
      data: {
        title: `TIV2 Chapter ${stamp}`,
        chapterLabel: `TIV2-${stamp}`,
        course: courseId,
        order: 0,
        status: 'published',
        isActive: true,
        tenant: tenantId,
        locale: 'he',
      } as any,
      overrideAccess: true,
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
    if (lessonId) {
      try {
        await payload.delete({ collection: 'lessons', id: lessonId, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    if (chapterId) {
      try {
        await payload.delete({ collection: 'chapters', id: chapterId, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    if (courseId) {
      try {
        await payload.delete({ collection: 'courses', id: courseId, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    if (categoryId) {
      try {
        await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
      } catch {
        /* ignore */
      }
    }
    await payload.db?.destroy?.()
  }, 120_000)

  it('creates lesson + exercise + sections with geometry attachments', async () => {
    const result = await importTextLessonFromFile(payloadRequest, {
      chapterId,
      filename: 'כיתה ז - שיעור 22 - זוויות צמודות וקדקודיות.txt',
      text: V2_LESSON_TEXT,
    })

    expect(result).toMatchObject({ success: true, exercisesCreated: 1, exercisesFailed: 0 })
    if (!('lessonId' in result) || !result.lessonId) throw new Error('expected lessonId')
    lessonId = result.lessonId

    // Lesson title comes from deriveLessonTitle stripping "כיתה" and "שיעור" segments.
    const lesson = await payload.findByID({ collection: 'lessons', id: lessonId, depth: 0 })
    expect(lesson.title).toBe('זוויות צמודות וקדקודיות')

    const exercises = await payload.find({
      collection: 'exercises',
      where: { lesson: { equals: lessonId } },
      sort: 'order',
      overrideAccess: true,
      depth: 0,
    })
    expect(exercises.docs).toHaveLength(1)
    const exercise = exercises.docs[0] as { id: string; content?: any }
    exerciseIds.push(exercise.id)

    // Shared blocks: intro rich_text + standalone question_geometry
    const sharedBlocks = (exercise.content?.blocks ?? []) as Array<{ type: string }>
    const sharedTypes = sharedBlocks.map((b) => b.type)
    expect(sharedTypes).toEqual(['rich_text', 'question_geometry'])

    const sections = await payload.find({
      collection: 'sections',
      where: { exercise: { equals: exercise.id } },
      sort: 'order',
      overrideAccess: true,
      depth: 0,
    })
    expect(sections.docs).toHaveLength(2)
    for (const s of sections.docs) sectionIds.push(s.id)

    // Section א' — MCQ with geometry attachment
    const mcq = sections.docs[0] as { title: string; content?: any }
    expect(mcq.title).toBe("סעיף א'")
    const mcqBlocks = (mcq.content?.blocks ?? []) as Array<{
      type: string
      attachment?: { kind?: string }
    }>
    expect(mcqBlocks).toHaveLength(1)
    expect(mcqBlocks[0].type).toBe('question_select')
    expect(mcqBlocks[0].attachment?.kind).toBe('geometry')

    // Section ב' — Open Ended, no attachment (no per-section geometry in fixture)
    const open = sections.docs[1] as { title: string; content?: any }
    expect(open.title).toBe("סעיף ב'")
    const openBlocks = (open.content?.blocks ?? []) as Array<{ type: string }>
    expect(openBlocks).toHaveLength(1)
    expect(openBlocks[0].type).toBe('question_free_response')

    // lesson.blocks playlist references the created exercise
    const fresh = await payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 0,
      overrideAccess: true,
    })
    const playlist = typeof fresh.blocks === 'string' ? JSON.parse(fresh.blocks) : fresh.blocks
    expect(Array.isArray(playlist)).toBe(true)
    expect(playlist).toEqual([
      expect.objectContaining({ blockType: 'exerciseRef', exercise: exercise.id }),
    ])
  }, 120_000)
})
