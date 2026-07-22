/**
 * POST /api/courses/:id/duplicate-course
 *
 * @fileType api-route
 * @domain courses
 * @pattern duplication-deep-clone
 * @ai-summary Deep-clones a course + all chapters + all lessons + all exercises inline. No AI variation.
 *
 * Body: {} (no options — course duplication is always an exact copy)
 *
 * Uses the same `level: 'none'` semantics the lesson duplication pipeline
 * exposes: every child is copied field-for-field, with slugs stripped so the
 * downstream beforeChange hooks regenerate them, and only inherent references
 * (chapter → course, lesson → chapter, exercise → lesson) are rewired to point
 * at the newly created parents.
 *
 * Path is `/duplicate-course` (not `/duplicate`) to avoid Payload's built-in
 * collection duplicate handler at `/api/courses/:id/duplicate`, which would
 * otherwise shadow this endpoint. `Courses` also sets `disableDuplicate: true`
 * to hide the built-in from the admin UI, but the route still exists — keep
 * this path distinct.
 *
 * Access: admin only.
 */
import type { PayloadRequest } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'

/** Strip Payload-managed fields from a doc so it can be passed to `create`. */
function stripManagedFields<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = doc as T & {
    id?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }
  void _id
  void _c
  void _u
  return rest
}

/** Short base36 timestamp used to guarantee slug uniqueness on cloned rows. */
function shortSuffix(): string {
  return Date.now().toString(36).slice(-6)
}

/**
 * Deep-clone a single lesson (+ its exercises) into a new lesson under the
 * given chapter/course. Adapted from `deepCloneLesson` in the lessons endpoint
 * — same field-strip + per-exercise isolation strategy — but with `chapter` +
 * `course` rewired to the freshly cloned parents.
 */
async function deepCloneLessonUnderChapter(
  req: PayloadRequest,
  sourceLessonId: string,
  newChapterId: string,
  newCourseId: string,
): Promise<{ id: string; exercisesCloned: number; exercisesFailed: number }> {
  const source = await req.payload.findByID({
    collection: 'lessons',
    id: sourceLessonId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const sourceData = stripManagedFields(source as unknown as Record<string, unknown>)
  const {
    slug: _ignoreSlug,
    blocks: _ignoreBlocks,
    translatedFrom: _ignoreTranslatedFrom,
    createdBy: _ignoreCreatedBy,
    chapter: _ignoreChapter,
    course: _ignoreCourse,
    ...restSource
  } = sourceData as Record<string, unknown>
  void _ignoreSlug
  void _ignoreBlocks
  void _ignoreTranslatedFrom
  void _ignoreCreatedBy
  void _ignoreChapter
  void _ignoreCourse

  // Keep the lesson title identical — we're cloning as part of a course-wide
  // copy, so appending " - Copy" to every lesson would produce noisy titles
  // like "Lesson 1 - Copy" inside a course that's already called
  // "Course 8 - Copy". The lesson's slug beforeChange hook has its own
  // retry-with-counter loop, so slug collisions inside the new course are
  // handled without us pre-computing suffixes.
  const newLessonData = {
    ...restSource,
    chapter: newChapterId,
    course: newCourseId,
    status: 'draft',
  }

  const newLesson = await req.payload.create({
    collection: 'lessons',
    data: newLessonData as never,
    overrideAccess: true,
    req,
  })

  const { getSourceExercisesForLesson } =
    await import('@/server/services/lesson-duplication/source-exercises')
  const exerciseDocs = await getSourceExercisesForLesson(req.payload, sourceLessonId)

  const newExerciseIds: string[] = []
  let failed = 0
  for (const exercise of exerciseDocs) {
    try {
      const exData = stripManagedFields(exercise as unknown as Record<string, unknown>)
      const created = await req.payload.create({
        collection: 'exercises',
        data: { ...exData, lesson: newLesson.id } as never,
        overrideAccess: true,
        req,
        context: { _skipBlockSync: true },
      })
      newExerciseIds.push(created.id)
    } catch (err) {
      failed++
      const reason = err instanceof Error ? err.message : 'unknown'
      req.payload.logger.warn(
        `[duplicateCourseEndpoint] skipped exercise ${exercise.id}: ${reason}`,
      )
    }
  }

  if (newExerciseIds.length > 0) {
    const blocks = newExerciseIds.map((exId) => ({
      id: Math.random().toString(36).slice(2, 14),
      blockType: 'exerciseRef' as const,
      exercise: exId,
    }))
    await req.payload.update({
      collection: 'lessons',
      id: newLesson.id,
      data: { blocks: JSON.stringify(blocks) },
      overrideAccess: true,
      req,
      context: { _skipBlockSync: true },
    })
  }

  return { id: newLesson.id, exercisesCloned: newExerciseIds.length, exercisesFailed: failed }
}

/**
 * Deep-clone a single chapter (+ all its lessons + exercises) under the new
 * course. Chapters have a global `unique: true` index on `slug`, so we
 * proactively assign a suffixed slug rather than relying on the hook (which
 * only regenerates when the slug is empty and does not retry on collision).
 */
async function deepCloneChapterUnderCourse(
  req: PayloadRequest,
  sourceChapterId: string,
  newCourseId: string,
  slugSuffix: string,
): Promise<{
  id: string
  lessonsCloned: number
  lessonsFailed: number
  exercisesCloned: number
  exercisesFailed: number
}> {
  const source = await req.payload.findByID({
    collection: 'chapters',
    id: sourceChapterId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const sourceData = stripManagedFields(source as unknown as Record<string, unknown>)
  const {
    slug: sourceSlug,
    translatedFrom: _ignoreTranslatedFrom,
    createdBy: _ignoreCreatedBy,
    course: _ignoreCourse,
    adminTitle: _ignoreAdminTitle,
    ...restSource
  } = sourceData as Record<string, unknown>
  void _ignoreTranslatedFrom
  void _ignoreCreatedBy
  void _ignoreCourse
  void _ignoreAdminTitle

  const baseTitle = typeof sourceData.title === 'string' ? sourceData.title : 'Untitled'
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(baseTitle)
  const uniqueSlug = `${baseSlug}-copy-${slugSuffix}`

  const newChapter = await req.payload.create({
    collection: 'chapters',
    data: {
      ...restSource,
      course: newCourseId,
      slug: uniqueSlug,
      status: 'draft',
    } as never,
    overrideAccess: true,
    req,
  })

  // Find all lessons under this source chapter and clone each into the new
  // chapter. Lesson slugs are per-lesson-collection-unique, so we let the
  // lesson's own beforeChange hook handle collision retries.
  const lessonsRes = await req.payload.find({
    collection: 'lessons',
    where: { chapter: { equals: sourceChapterId } },
    limit: 500,
    depth: 0,
    overrideAccess: true,
    req,
  })

  let lessonsCloned = 0
  let lessonsFailed = 0
  let exercisesCloned = 0
  let exercisesFailed = 0
  for (const lesson of lessonsRes.docs) {
    try {
      const result = await deepCloneLessonUnderChapter(req, lesson.id, newChapter.id, newCourseId)
      lessonsCloned++
      exercisesCloned += result.exercisesCloned
      exercisesFailed += result.exercisesFailed
    } catch (err) {
      lessonsFailed++
      const reason = err instanceof Error ? err.message : 'unknown'
      req.payload.logger.warn(
        `[duplicateCourseEndpoint] skipped lesson ${lesson.id} under chapter ${sourceChapterId}: ${reason}`,
      )
    }
  }

  return {
    id: newChapter.id,
    lessonsCloned,
    lessonsFailed,
    exercisesCloned,
    exercisesFailed,
  }
}

export async function duplicateCourseEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/courses\/([^/]+)\/duplicate-course/)
  const courseId = match?.[1]
  if (!courseId) {
    return Response.json({ error: 'Course id missing from path' }, { status: 400 })
  }

  let source: Record<string, unknown>
  try {
    source = (await req.payload.findByID({
      collection: 'courses',
      id: courseId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Record<string, unknown>
  } catch {
    return Response.json({ error: `Course "${courseId}" not found` }, { status: 404 })
  }

  const sourceData = stripManagedFields(source)
  const {
    slug: sourceSlug,
    translatedFrom: _ignoreTranslatedFrom,
    createdBy: _ignoreCreatedBy,
    ...restSource
  } = sourceData as Record<string, unknown>
  void _ignoreTranslatedFrom
  void _ignoreCreatedBy

  const baseTitle = typeof sourceData.title === 'string' ? sourceData.title : 'Untitled'
  const newTitle = `${baseTitle} - Copy`
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(baseTitle)
  // enforceFieldLocaleUniqueness('courses') keys on (slug, locale). The
  // suffix guarantees a first-try success for the create; admins can rename
  // slug + title afterwards.
  const suffix = shortSuffix()
  const newSlug = `${baseSlug}-copy-${suffix}`

  const newCourseData = {
    ...restSource,
    title: newTitle,
    slug: newSlug,
    status: 'draft',
  }

  let newCourseId: string
  try {
    const newCourse = await req.payload.create({
      collection: 'courses',
      data: newCourseData as never,
      overrideAccess: true,
      req,
    })
    newCourseId = newCourse.id
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `Course create failed: ${message}` }, { status: 500 })
  }

  // Load chapters that belong to the source course, then clone each — every
  // child chapter reuses the same slug suffix so a whole course-copy is easy
  // to spot after the fact. Chapters are capped at 500 per course, which is
  // well above realistic content sizes.
  const chaptersRes = await req.payload.find({
    collection: 'chapters',
    where: { course: { equals: courseId } },
    limit: 500,
    depth: 0,
    overrideAccess: true,
    req,
  })

  let chaptersCloned = 0
  let chaptersFailed = 0
  let lessonsCloned = 0
  let lessonsFailed = 0
  let exercisesCloned = 0
  let exercisesFailed = 0
  for (const chapter of chaptersRes.docs) {
    try {
      const result = await deepCloneChapterUnderCourse(req, chapter.id, newCourseId, suffix)
      chaptersCloned++
      lessonsCloned += result.lessonsCloned
      lessonsFailed += result.lessonsFailed
      exercisesCloned += result.exercisesCloned
      exercisesFailed += result.exercisesFailed
    } catch (err) {
      chaptersFailed++
      const reason = err instanceof Error ? err.message : 'unknown'
      req.payload.logger.warn(`[duplicateCourseEndpoint] skipped chapter ${chapter.id}: ${reason}`)
    }
  }

  return Response.json({
    outputCourseId: newCourseId,
    counts: {
      chaptersCloned,
      chaptersFailed,
      lessonsCloned,
      lessonsFailed,
      exercisesCloned,
      exercisesFailed,
    },
  })
}
