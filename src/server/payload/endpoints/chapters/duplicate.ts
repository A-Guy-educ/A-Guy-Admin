/**
 * POST /api/chapters/:id/duplicate-chapter
 *
 * @fileType api-route
 * @domain chapters
 * @pattern duplication-single-doc
 * @ai-summary Deep-clones a chapter and every lesson + exercise + section underneath it.
 *
 * Payload's built-in per-collection duplicate is a shallow field copy: for
 * chapters it creates a new chapter with the same scalar fields and the same
 * `course` FK but does NOT clone the lessons that reference it. The resulting
 * "duplicate" chapter is empty — same bug the sibling course/lesson/exercise
 * endpoints exist to fix.
 *
 * The Chapters collection has `disableDuplicate: true` so Payload's built-in
 * duplicate route doesn't shadow this one (mirrors the lessons/exercises/sections
 * endpoints).
 *
 * Body: {} (no options — chapter duplication is always an exact copy).
 *
 * Why this isn't a thin wrapper around `duplicateCourseEndpoint`:
 *   - The course endpoint uses raw `insertMany` for performance across ~1000-row
 *     clones. A single chapter is a much smaller unit of work, and running
 *     per-doc `payload.create` keeps every lesson/exercise/section hook
 *     (slug uniqueness, computeAdminTitle, auto-populate FKs) in play — same
 *     posture as the lesson-level and exercise-level duplicates.
 *
 * Access: admin only. Matches `duplicateCourseEndpoint`, `duplicateLessonEndpoint`,
 * and `duplicateExerciseEndpoint`.
 */
import type { PayloadRequest } from 'payload'

import { deepCloneLesson } from '@/server/services/duplication/clone-lesson'
import { stripManagedFields } from '@/server/services/duplication/strip-managed-fields'

export async function duplicateChapterEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/chapters\/([^/]+)\/duplicate-chapter/)
  const sourceChapterId = match?.[1]
  if (!sourceChapterId) {
    return Response.json({ error: 'Chapter id missing from path' }, { status: 400 })
  }

  // 1) Load source. depth:0 keeps FKs as id strings we can pass straight to create.
  let source: Record<string, unknown> & { id: string }
  try {
    source = (await req.payload.findByID({
      collection: 'chapters',
      id: sourceChapterId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Record<string, unknown> & { id: string }
  } catch {
    return Response.json({ error: `Chapter "${sourceChapterId}" not found` }, { status: 404 })
  }

  // 2) Build new-chapter payload. Spread the source so the clone inherits
  //    course, chapterLabel, description, mediaFiles, order, isActive, etc.,
  //    but drop fields that shouldn't carry over to a fresh doc:
  //    - slug: `unique: true` globally — passing the source value collides.
  //      The beforeChange hook on Chapters re-derives slug from title when empty.
  //    - translatedFrom: the duplicate is a fresh chapter, not a translation.
  //    - createdBy: inheriting the source's createdBy would misattribute the clone.
  //    - adminTitle: computeAdminTitle rebuilds it from title + course on insert.
  const stripped = stripManagedFields(source)
  const {
    slug: _sourceSlug,
    translatedFrom: _tf,
    createdBy: _cb,
    adminTitle: _at,
    ...rest
  } = stripped as Record<string, unknown>
  void _sourceSlug
  void _tf
  void _cb
  void _at

  const baseTitle = typeof stripped.title === 'string' ? stripped.title : 'Untitled'
  const newChapterData = {
    ...rest,
    title: `${baseTitle} - Copy`,
    status: 'draft',
  }

  const newChapter = await req.payload.create({
    collection: 'chapters',
    data: newChapterData as never,
    overrideAccess: true,
    req,
  })

  // 3) Find every lesson under the source chapter and deep-clone each into
  //    the new chapter. Per-lesson isolation: a single bad lesson shouldn't
  //    kill the whole chapter clone. Log and continue.
  //
  //    Pagination: Payload's default limit silently truncates large chapters.
  //    Walk every page so we don't drop lessons on chapters > 10 lessons.
  const sourceLessons: Array<{ id: string }> = []
  const PAGE_SIZE = 100
  for (let page = 1; ; page++) {
    const res = await req.payload.find({
      collection: 'lessons',
      where: { chapter: { equals: sourceChapterId } },
      limit: PAGE_SIZE,
      page,
      depth: 0,
      overrideAccess: true,
      req,
    })
    sourceLessons.push(...(res.docs as Array<{ id: string }>))
    if (!res.hasNextPage) break
  }

  let lessonsCloned = 0
  let lessonsFailed = 0
  const failures: Array<{ sourceLessonId: string; reason: string }> = []
  for (const lesson of sourceLessons) {
    try {
      await deepCloneLesson(req, lesson.id, { overrideChapterId: newChapter.id })
      lessonsCloned += 1
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      lessonsFailed += 1
      failures.push({ sourceLessonId: lesson.id, reason })
      req.payload.logger.warn(
        `[duplicateChapterEndpoint] lesson ${lesson.id} failed to clone: ${reason}`,
      )
    }
  }

  if (failures.length > 0) {
    req.payload.logger.warn(
      { chapterId: sourceChapterId, newChapterId: newChapter.id, failures },
      `[duplicateChapterEndpoint] ${failures.length} lesson(s) failed to clone`,
    )
  }

  return Response.json({
    outputChapterId: newChapter.id,
    counts: {
      lessonsCloned,
      lessonsFailed,
    },
  })
}
