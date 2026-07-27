/**
 * POST /api/courses/:id/duplicate-course
 *
 * @fileType api-route
 * @domain courses
 * @pattern duplication-deep-clone
 * @ai-summary Deep-clones a course + all chapters + all lessons + all exercises + all sections inline. No AI variation.
 *
 * Body: {} (no options — course duplication is always an exact copy)
 *
 * Uses the same `level: 'none'` semantics the lesson duplication pipeline
 * exposes: every child is copied field-for-field, with slugs stripped so the
 * downstream beforeChange hooks regenerate them, and inherent references
 * (chapter → course, lesson → chapter, exercise → lesson, section → exercise)
 * are rewired to point at the freshly cloned parents.
 *
 * Sections carry the actual question content — cloning exercises alone would
 * leave the new exercise.blocks[].section entries pointing at the ORIGINAL
 * section rows, so any edit inside the duplicated course would silently mutate
 * the source course. This endpoint clones sections and rewrites the new
 * exercise's playlist to reference the new section ids.
 *
 * PERFORMANCE — hooks skipped via content-promotion marker.
 * The heavy per-doc hooks (computeSectionAdminTitle: up to 4 findByIDs, the
 * section auto-populate lesson/chapter/course walk, the exercise auto-populate
 * chapter/course walk, computeLessonAdminTitle, the per-collection slug
 * uniqueness retries) all check `isContentPromotionImportRequest(req)` and
 * short-circuit when it's true. Without the marker, a 50-lesson course produced
 * ~10,000+ redundant Mongo round-trips and blew past Vercel's 5-min ceiling
 * after 10 lessons. The marker is on the whole clone request, so we take
 * responsibility for the values those hooks would have computed:
 *   - lesson slugs are pre-computed unique (`{baseSlug}-copy-{suffix}`)
 *   - chapter / course / lesson denormalized fields are passed explicitly
 *   - lesson + section `adminTitle` breadcrumbs are pre-computed in-memory
 *     from titles we already have (no extra reads)
 *
 * Path is `/duplicate-course` (not `/duplicate`) to avoid Payload's built-in
 * collection duplicate handler at `/api/courses/:id/duplicate`, which would
 * otherwise shadow this endpoint. `Courses` also sets `disableDuplicate: true`
 * to hide the built-in from the admin UI, but the route still exists — keep
 * this path distinct.
 *
 * Access: admin only.
 */
import { randomBytes } from 'crypto'

import type { Payload, PayloadRequest, Where } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'
import { getSourceExercisesForLesson } from '@/server/services/lesson-duplication/source-exercises'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'

const CHILD_QUERY_PAGE_SIZE = 200

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

/**
 * 6-char hex suffix used to guarantee slug uniqueness on cloned rows.
 * Uses `crypto.randomBytes` rather than a truncated `Date.now()` so two admins
 * duplicating the same course within the same millisecond can't collide on a
 * globally-unique chapter slug.
 */
function shortSuffix(): string {
  return randomBytes(3).toString('hex')
}

/**
 * Random 12-char base36 id for playlist blocks (lesson.blocks[].id and
 * exercise.blocks[].id). Not security-sensitive — these are just per-playlist
 * keys used to identify entries when the array is edited.
 */
function newBlockId(): string {
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Join non-empty parts with " / " — matches the format
 * computeLessonAdminTitle / computeSectionAdminTitle would produce, without
 * doing any Mongo lookups. Used to keep the admin list view readable on the
 * cloned rows.
 */
function joinBreadcrumb(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' / ')
}

/**
 * Fetch every doc matching the filter, paging in `CHILD_QUERY_PAGE_SIZE`
 * chunks. Payload's default `limit` silently truncates — a course with more
 * chapters/lessons than the cap would report success with partial counts.
 */
async function findAllPages<T extends { id: string }>(
  payload: Payload,
  req: PayloadRequest,
  collection: 'chapters' | 'lessons' | 'sections',
  where: Where,
): Promise<T[]> {
  const results: T[] = []
  let page = 1
  for (;;) {
    const res = await payload.find({
      collection,
      where,
      limit: CHILD_QUERY_PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
      req,
    })
    results.push(...(res.docs as unknown as T[]))
    if (!res.hasNextPage) break
    page++
  }
  return results
}

interface SectionRefBlock {
  id?: string
  blockType?: string
  section?: string
  [key: string]: unknown
}

/** Parse the exercise `blocks` field (JSON string OR array) into a typed list. */
function parseSectionRefBlocks(raw: unknown): SectionRefBlock[] {
  if (Array.isArray(raw)) return raw as SectionRefBlock[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as SectionRefBlock[]
    } catch {
      // Malformed blocks JSON on the source — treat as empty playlist so we
      // still create the new exercise instead of aborting the whole clone.
    }
  }
  return []
}

interface CloneTitles {
  newCourseTitle: string
  chapterTitle: string
  lessonTitle: string
}

/**
 * Clone every section under `sourceExerciseId` into the new exercise. Returns
 * the id map (old → new) plus a failure count. Passes `_skipExerciseBlockSync`
 * so the section afterChange hook doesn't append to the new exercise's blocks
 * one section at a time — we rebuild the whole array atomically once all
 * sections are in.
 */
async function cloneSectionsUnderExercise(
  req: PayloadRequest,
  sourceExerciseId: string,
  newExerciseId: string,
  newLessonId: string,
  newChapterId: string,
  newCourseId: string,
  exerciseTitle: string,
  titles: CloneTitles,
): Promise<{ idMap: Map<string, string>; sectionsCloned: number; sectionsFailed: number }> {
  const sourceSections = await findAllPages<Record<string, unknown> & { id: string }>(
    req.payload,
    req,
    'sections',
    { exercise: { equals: sourceExerciseId } },
  )

  const idMap = new Map<string, string>()
  let failed = 0
  for (const section of sourceSections) {
    try {
      // `findAllPages` already fetched the full section doc at depth 0 — no
      // need for a second round-trip per section.
      const sData = stripManagedFields(section as unknown as Record<string, unknown>)
      const {
        translatedFrom: _ignoreTranslatedFrom,
        createdBy: _ignoreCreatedBy,
        adminTitle: _ignoreAdminTitle,
        exercise: _ignoreExercise,
        lesson: _ignoreLesson,
        chapter: _ignoreChapter,
        course: _ignoreCourse,
        ...restSection
      } = sData as Record<string, unknown>
      void _ignoreTranslatedFrom
      void _ignoreCreatedBy
      void _ignoreAdminTitle
      void _ignoreExercise
      void _ignoreLesson
      void _ignoreChapter
      void _ignoreCourse

      const sectionTitle =
        typeof (sData as { title?: unknown }).title === 'string'
          ? ((sData as { title?: string }).title as string)
          : ''
      const adminTitle = joinBreadcrumb([
        titles.newCourseTitle,
        titles.chapterTitle,
        titles.lessonTitle,
        exerciseTitle,
        sectionTitle,
      ])

      const created = await req.payload.create({
        collection: 'sections',
        data: {
          ...restSection,
          exercise: newExerciseId,
          lesson: newLessonId,
          chapter: newChapterId,
          course: newCourseId,
          adminTitle,
        } as never,
        overrideAccess: true,
        req,
        context: { _skipExerciseBlockSync: true },
      })
      idMap.set(section.id, created.id)
    } catch (err) {
      failed++
      const reason = err instanceof Error ? err.message : 'unknown'
      req.payload.logger.warn(
        `[duplicateCourseEndpoint] skipped section ${section.id} under exercise ${sourceExerciseId}: ${reason}`,
      )
    }
  }
  return { idMap, sectionsCloned: idMap.size, sectionsFailed: failed }
}

/**
 * Deep-clone a single lesson (+ its exercises + their sections) into a new
 * lesson under the given chapter/course. Adapted from `deepCloneLesson` in the
 * lessons endpoint — same field-strip + per-exercise isolation strategy — but
 * with `chapter` + `course` rewired to the freshly cloned parents and with
 * sections cloned too so the two courses don't share section rows.
 *
 * Because the request is marked as content-promotion (see endpoint header),
 * the lesson beforeChange slug hook and computeLessonAdminTitle short-circuit
 * — we pre-compute both here.
 */
async function deepCloneLessonUnderChapter(
  req: PayloadRequest,
  sourceLesson: Record<string, unknown> & { id: string },
  newChapterId: string,
  newCourseId: string,
  slugSuffix: string,
  titles: Pick<CloneTitles, 'newCourseTitle' | 'chapterTitle'>,
): Promise<{
  id: string
  exercisesCloned: number
  exercisesFailed: number
  sectionsCloned: number
  sectionsFailed: number
}> {
  const sourceData = stripManagedFields(sourceLesson as unknown as Record<string, unknown>)
  const {
    slug: sourceSlug,
    blocks: _ignoreBlocks,
    translatedFrom: _ignoreTranslatedFrom,
    createdBy: _ignoreCreatedBy,
    chapter: _ignoreChapter,
    course: _ignoreCourse,
    adminTitle: _ignoreAdminTitle,
    ...restSource
  } = sourceData as Record<string, unknown>
  void _ignoreBlocks
  void _ignoreTranslatedFrom
  void _ignoreCreatedBy
  void _ignoreChapter
  void _ignoreCourse
  void _ignoreAdminTitle

  const lessonTitle =
    typeof sourceData.title === 'string' ? (sourceData.title as string) : 'Untitled'
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(lessonTitle)
  // Lesson slugs are globally unique. The slug beforeChange retry loop is
  // skipped (content-promotion marker), so pre-compute a unique slug — same
  // pattern chapters use above.
  const newLessonSlug = `${baseSlug}-copy-${slugSuffix}`
  const adminTitle = joinBreadcrumb([titles.newCourseTitle, titles.chapterTitle, lessonTitle])

  const newLessonData = {
    ...restSource,
    chapter: newChapterId,
    course: newCourseId,
    slug: newLessonSlug,
    adminTitle,
    status: 'draft',
  }

  const newLesson = await req.payload.create({
    collection: 'lessons',
    data: newLessonData as never,
    overrideAccess: true,
    req,
  })

  const exerciseDocs = await getSourceExercisesForLesson(req.payload, sourceLesson.id)

  const newExerciseIds: string[] = []
  let exercisesFailed = 0
  let sectionsCloned = 0
  let sectionsFailed = 0
  const lessonTitles: CloneTitles = {
    newCourseTitle: titles.newCourseTitle,
    chapterTitle: titles.chapterTitle,
    lessonTitle,
  }
  for (const exercise of exerciseDocs) {
    try {
      const exData = stripManagedFields(exercise as unknown as Record<string, unknown>)
      const sourceBlocks = parseSectionRefBlocks((exData as { blocks?: unknown }).blocks)

      // Create the new exercise with an empty playlist first — we rewrite it
      // once sections are cloned so the entries reference the new section ids.
      const {
        blocks: _dropBlocks,
        chapter: _dropChapter,
        course: _dropCourse,
        ...exWithoutBlocks
      } = exData as Record<string, unknown>
      void _dropBlocks
      void _dropChapter
      void _dropCourse
      const created = await req.payload.create({
        collection: 'exercises',
        data: {
          ...exWithoutBlocks,
          lesson: newLesson.id,
          chapter: newChapterId,
          course: newCourseId,
          blocks: JSON.stringify([]),
        } as never,
        overrideAccess: true,
        req,
        context: { _skipBlockSync: true },
      })

      const exerciseTitle =
        typeof (exData as { title?: unknown }).title === 'string'
          ? ((exData as { title?: string }).title as string)
          : ''

      const {
        idMap,
        sectionsCloned: sc,
        sectionsFailed: sf,
      } = await cloneSectionsUnderExercise(
        req,
        exercise.id,
        created.id,
        newLesson.id,
        newChapterId,
        newCourseId,
        exerciseTitle,
        lessonTitles,
      )
      sectionsCloned += sc
      sectionsFailed += sf

      // Rebuild the exercise's playlist in the source order, remapping each
      // sectionRef.section via the id map. Entries whose section wasn't cloned
      // (unmapped) are dropped — they'd be dangling refs otherwise.
      const rebuiltBlocks: SectionRefBlock[] = sourceBlocks
        .map((block) => {
          if (block.blockType !== 'sectionRef' || typeof block.section !== 'string') return block
          const newSectionId = idMap.get(block.section)
          if (!newSectionId) return null
          return {
            ...block,
            id: newBlockId(),
            section: newSectionId,
          }
        })
        .filter((b): b is SectionRefBlock => b !== null)

      await req.payload.update({
        collection: 'exercises',
        id: created.id,
        data: { blocks: JSON.stringify(rebuiltBlocks) },
        overrideAccess: true,
        req,
        context: { _skipExerciseBlockSync: true, _skipBlockSync: true },
      })

      newExerciseIds.push(created.id)
    } catch (err) {
      exercisesFailed++
      const reason = err instanceof Error ? err.message : 'unknown'
      req.payload.logger.warn(
        `[duplicateCourseEndpoint] skipped exercise ${exercise.id}: ${reason}`,
      )
    }
  }

  if (newExerciseIds.length > 0) {
    const blocks = newExerciseIds.map((exId) => ({
      id: newBlockId(),
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

  return {
    id: newLesson.id,
    exercisesCloned: newExerciseIds.length,
    exercisesFailed,
    sectionsCloned,
    sectionsFailed,
  }
}

/**
 * Deep-clone a single chapter (+ all its lessons + exercises + sections) under
 * the new course. Chapters have a global `unique: true` index on `slug`, so we
 * proactively assign a suffixed slug rather than relying on the hook (which
 * only regenerates when the slug is empty and does not retry on collision).
 */
async function deepCloneChapterUnderCourse(
  req: PayloadRequest,
  sourceChapter: Record<string, unknown> & { id: string },
  newCourseId: string,
  slugSuffix: string,
  newCourseTitle: string,
): Promise<{
  id: string
  lessonsCloned: number
  lessonsFailed: number
  exercisesCloned: number
  exercisesFailed: number
  sectionsCloned: number
  sectionsFailed: number
}> {
  const sourceData = stripManagedFields(sourceChapter as unknown as Record<string, unknown>)
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

  const chapterTitle =
    typeof sourceData.title === 'string' ? (sourceData.title as string) : 'Untitled'
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(chapterTitle)
  const uniqueSlug = `${baseSlug}-copy-${slugSuffix}`
  // Pre-compute chapter adminTitle in the same "title — course" format that
  // computeAdminTitle (chapters/computeAdminTitle.ts) would produce, and set
  // `skipAdminTitleRecompute` so the hook short-circuits its own findByID.
  const chapterAdminTitle = `${chapterTitle} — ${newCourseTitle}`

  const newChapter = await req.payload.create({
    collection: 'chapters',
    data: {
      ...restSource,
      course: newCourseId,
      slug: uniqueSlug,
      status: 'draft',
      adminTitle: chapterAdminTitle,
    } as never,
    overrideAccess: true,
    req,
    context: { skipAdminTitleRecompute: true },
  })

  const sourceLessons = await findAllPages<Record<string, unknown> & { id: string }>(
    req.payload,
    req,
    'lessons',
    { chapter: { equals: sourceChapter.id } },
  )

  let lessonsCloned = 0
  let lessonsFailed = 0
  let exercisesCloned = 0
  let exercisesFailed = 0
  let sectionsCloned = 0
  let sectionsFailed = 0
  for (const lesson of sourceLessons) {
    try {
      const result = await deepCloneLessonUnderChapter(
        req,
        lesson,
        newChapter.id,
        newCourseId,
        slugSuffix,
        { newCourseTitle, chapterTitle },
      )
      lessonsCloned++
      exercisesCloned += result.exercisesCloned
      exercisesFailed += result.exercisesFailed
      sectionsCloned += result.sectionsCloned
      sectionsFailed += result.sectionsFailed
    } catch (err) {
      lessonsFailed++
      const reason = err instanceof Error ? err.message : 'unknown'
      req.payload.logger.warn(
        `[duplicateCourseEndpoint] skipped lesson ${lesson.id} under chapter ${sourceChapter.id}: ${reason}`,
      )
    }
  }

  return {
    id: newChapter.id,
    lessonsCloned,
    lessonsFailed,
    exercisesCloned,
    exercisesFailed,
    sectionsCloned,
    sectionsFailed,
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

  // Mark the whole clone as a content-promotion import. Every heavy per-doc
  // hook (adminTitle compute, denormalized-field walks, slug uniqueness
  // retries, block-sync afterChange) checks this flag and short-circuits.
  // Without this, a 50-lesson course took >5min just on redundant Mongo
  // round-trips. See the endpoint header for the full rationale.
  markRequestAsContentPromotionImport(req)

  // Use `find` instead of `findByID` for the existence check. `findByID`
  // rejects on any error (not-found, malformed id, access-layer throw) with
  // the same shape, which used to be reported here as a 404 — hiding real
  // problems (e.g. bad DB connection) behind a "not found" message.
  const existsRes = await req.payload.find({
    collection: 'courses',
    where: { id: { equals: courseId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const source = existsRes.docs[0] as unknown as Record<string, unknown> | undefined
  if (!source) {
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

  // Let the Next.js route wrapper handle 500s uniformly — it logs the full
  // error server-side and returns a scrubbed message. Echoing raw exception
  // text here bypassed that scrubbing on the course-create branch alone.
  const newCourse = await req.payload.create({
    collection: 'courses',
    data: newCourseData as never,
    overrideAccess: true,
    req,
  })
  const newCourseId = newCourse.id

  // Load every chapter that belongs to the source course (paginated — no
  // hard cap that could silently truncate a large course) and clone each.
  const sourceChapters = await findAllPages<Record<string, unknown> & { id: string }>(
    req.payload,
    req,
    'chapters',
    { course: { equals: courseId } },
  )

  let chaptersCloned = 0
  let chaptersFailed = 0
  let lessonsCloned = 0
  let lessonsFailed = 0
  let exercisesCloned = 0
  let exercisesFailed = 0
  let sectionsCloned = 0
  let sectionsFailed = 0
  for (const chapter of sourceChapters) {
    try {
      const result = await deepCloneChapterUnderCourse(req, chapter, newCourseId, suffix, newTitle)
      chaptersCloned++
      lessonsCloned += result.lessonsCloned
      lessonsFailed += result.lessonsFailed
      exercisesCloned += result.exercisesCloned
      exercisesFailed += result.exercisesFailed
      sectionsCloned += result.sectionsCloned
      sectionsFailed += result.sectionsFailed
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
      sectionsCloned,
      sectionsFailed,
    },
  })
}
