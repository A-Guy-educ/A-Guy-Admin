/**
 * Deep-clone a lesson and every exercise + section underneath it.
 *
 * @fileType service
 * @domain duplication
 * @pattern clone-and-rewire
 * @ai-summary Lesson-tree deep clone, shared by the lesson-level and chapter-level duplicate endpoints.
 *
 * Extracted from `endpoints/lessons/duplicate.ts` so the chapter-duplicate
 * endpoint can clone each lesson under a chapter without re-implementing the
 * same create-exercise + rewire-sections dance.
 *
 * Caller contract:
 *   - Passes the source lesson id.
 *   - Optionally overrides the resulting lesson's `chapter` FK. Used by the
 *     chapter-duplicate flow so cloned lessons land under the newly-cloned
 *     chapter instead of the source lesson's chapter. The lesson's
 *     `beforeChange` hook refreshes `course` from the overriding chapter.
 *
 * Returns the id of the new lesson.
 *
 * The course-level duplicate (`endpoints/courses/duplicate.ts`) deliberately
 * does NOT use this helper — it clones ~1000 docs via raw `insertMany` to stay
 * sub-minute on real-world courses. See that file's header for context.
 */
import type { PayloadRequest } from 'payload'

import {
  cloneSectionsAndRewireExercises,
  type ExerciseClonePair,
} from './clone-sections-for-exercises'
import { stripManagedFields } from './strip-managed-fields'

export interface DeepCloneLessonOptions {
  /**
   * Override the `chapter` FK on the cloned lesson. If omitted the clone
   * inherits the source lesson's chapter (matches the standalone lesson-duplicate
   * flow). When set, the lesson's `beforeChange` hook recomputes `course` from
   * the overriding chapter's `course`, keeping the denormalized FK coherent.
   */
  overrideChapterId?: string
}

export async function deepCloneLesson(
  req: PayloadRequest,
  sourceLessonId: string,
  options: DeepCloneLessonOptions = {},
): Promise<string> {
  const source = await req.payload.findByID({
    collection: 'lessons',
    id: sourceLessonId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  // Build the new-lesson payload. We spread every non-managed source field so
  // the clone inherits accessType / visibleRenderers / contentStatus / etc.,
  // but explicitly drop fields that should NOT carry over:
  //  - slug: the formatSlugAsync hook regenerates it from the new title.
  //  - blocks: still references source exercise ids. The final batched write
  //    at the bottom of this function rebuilds blocks[] with the new ids.
  //  - translatedFrom: the duplicate is a fresh doc, not a translation.
  //  - createdBy: inheriting the source's createdBy would misattribute the clone.
  const sourceData = stripManagedFields(source as unknown as Record<string, unknown>)
  const baseTitle = typeof sourceData.title === 'string' ? sourceData.title : 'Untitled'
  const {
    slug: _ignoreSlug,
    blocks: _ignoreBlocks,
    translatedFrom: _ignoreTranslatedFrom,
    createdBy: _ignoreCreatedBy,
    ...restSource
  } = sourceData as Record<string, unknown>
  void _ignoreSlug
  void _ignoreBlocks
  void _ignoreTranslatedFrom
  void _ignoreCreatedBy

  const newLessonData: Record<string, unknown> = {
    ...restSource,
    title: `${baseTitle} - Copy`,
    status: 'draft',
  }
  if (options.overrideChapterId) {
    newLessonData.chapter = options.overrideChapterId
  }

  const newLesson = await req.payload.create({
    collection: 'lessons',
    data: newLessonData as never,
    overrideAccess: true,
    req,
  })

  // Resolve the source lesson's exercises. Prefer `lesson.blocks[].exercise`
  // (authoritative), fall back to the FK reverse query. The previous FK-only
  // path silently cloned zero exercises for lessons whose blocks referenced
  // exercises owned by a different lesson.
  const { getSourceExercisesForLesson } =
    await import('@/server/services/lesson-duplication/source-exercises')
  const exerciseDocs = await getSourceExercisesForLesson(req.payload, sourceLessonId)

  // Per-exercise isolation: a single bad exercise (e.g. legacy block field
  // that trips Zod strict mode) must not kill the whole clone. We also disable
  // the per-exercise addBlockToLesson hook via `_skipBlockSync` and rebuild
  // `lesson.blocks[]` in one atomic write at the end — otherwise the
  // concurrent in-flight hook promises race (observed: 44 exercises created,
  // but only 1 entry in lesson.blocks[] when the serverless function exits).
  //
  // We also pass empty `blocks` on create: the source `blocks` still points at
  // the SOURCE sections, and the section-rewire step below hands the new
  // exercise its own section graph. Leaving source blocks on the new exercise
  // would let a caller reading the exercise in the sub-second window between
  // create and rewire see stale section refs.
  const cloneFailures: Array<{ id: string; reason: string }> = []
  const clonePairs: ExerciseClonePair[] = []
  for (const exercise of exerciseDocs) {
    try {
      const exData = stripManagedFields(exercise as unknown as Record<string, unknown>)
      const { blocks: sourceBlocks, ...restEx } = exData as Record<string, unknown>
      const created = await req.payload.create({
        collection: 'exercises',
        data: { ...restEx, lesson: newLesson.id, blocks: '[]' } as never,
        overrideAccess: true,
        req,
        context: { _skipBlockSync: true },
      })
      clonePairs.push({
        sourceExerciseId: exercise.id,
        sourceBlocks,
        newExerciseId: created.id,
        newLessonId: newLesson.id,
        newChapterId:
          typeof newLesson.chapter === 'string'
            ? newLesson.chapter
            : ((newLesson.chapter as { id?: string } | null | undefined)?.id ?? null),
        newCourseId:
          typeof newLesson.course === 'string'
            ? newLesson.course
            : ((newLesson.course as { id?: string } | null | undefined)?.id ?? null),
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      cloneFailures.push({ id: exercise.id, reason })
      req.payload.logger.warn(
        `[deepCloneLesson] skipped exercise ${exercise.id} during deep clone: ${reason}`,
      )
    }
  }
  if (cloneFailures.length > 0) {
    req.payload.logger.warn(
      `[deepCloneLesson] ${cloneFailures.length} of ${exerciseDocs.length} exercises failed to clone for lesson ${sourceLessonId}`,
    )
  }

  // Clone every section referenced from the cloned exercises' block playlists
  // and rewrite each new exercise's `blocks` so its sectionRef entries point
  // at the newly-created section docs. Without this, admin edits on a
  // "duplicated" section would silently mutate the source lesson's section.
  const sectionResult = await cloneSectionsAndRewireExercises(req.payload, req, clonePairs)
  if (sectionResult.sectionsFailed > 0) {
    req.payload.logger.warn(
      `[deepCloneLesson] ${sectionResult.sectionsFailed} section(s) failed to clone for lesson ${sourceLessonId}`,
    )
  }

  // Final batched write: build the full blocks[] array from the cloned ids and
  // persist in a single lesson update. `_skipBlockSync` prevents the lesson
  // afterChange from triggering further block-sync churn.
  if (clonePairs.length > 0) {
    const blocks = clonePairs.map((pair) => ({
      id: Math.random().toString(36).slice(2, 14),
      blockType: 'exerciseRef' as const,
      exercise: pair.newExerciseId,
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

  return newLesson.id
}
