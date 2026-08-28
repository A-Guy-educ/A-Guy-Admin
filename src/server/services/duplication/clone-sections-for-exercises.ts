/**
 * Deep-clone every section referenced from a set of newly-cloned exercises'
 * `blocks` playlists, then rewrite each new exercise's `blocks` so its
 * `sectionRef` entries point at the freshly-created section ids.
 *
 * @fileType service
 * @domain duplication
 * @pattern clone-and-rewire
 * @ai-summary Section-graph deep clone for lesson/exercise duplicate endpoints.
 *
 * Used by:
 *  - `duplicateLessonEndpoint` (deepCloneLesson) — after exercises are cloned.
 *  - `duplicateExerciseEndpoint` — after the single exercise is cloned.
 *
 * The course-level duplicate has its own inline implementation in
 * `endpoints/courses/duplicate.ts` because it batches inserts via raw
 * `insertMany` for performance across ~1000-row clones. Lesson/exercise
 * duplicates are single-parent operations with far fewer sections, so this
 * helper uses `payload.create` for readability and to keep the section
 * hooks (adminTitle, slug uniqueness) running exactly as an admin-authored
 * section would.
 *
 * Without this step, cloned exercises' `blocks[].section` still point at the
 * SOURCE section documents — meaning any admin edit to a "duplicated"
 * section actually mutates the original, and vice-versa. That's the bug this
 * helper exists to prevent.
 */
import type { Payload, PayloadRequest } from 'payload'

import { stripManagedFields } from './strip-managed-fields'

interface BlockRef {
  id?: string
  blockType?: string
  section?: string
  [key: string]: unknown
}

/**
 * A single (source exercise, new exercise) pair with the full parent chain
 * the new section documents need for their FK fields.
 */
export interface ExerciseClonePair {
  sourceExerciseId: string
  sourceBlocks: unknown
  newExerciseId: string
  newLessonId: string | null
  newChapterId: string | null
  newCourseId: string | null
}

export interface CloneSectionsResult {
  sectionsCreated: number
  sectionsFailed: number
  /** oldSectionId → newSectionId for callers that need to trace pairs. */
  sectionIdMap: Map<string, string>
}

/** Random 12-char base36 id for playlist block entries. */
function newBlockId(): string {
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Parse a `blocks` field into a typed array. The field is stored as a JSON
 * string on both lessons and exercises, though some code paths hand us an
 * already-parsed array.
 */
function parseBlocks(raw: unknown): BlockRef[] {
  if (Array.isArray(raw)) return raw as BlockRef[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockRef[]
    } catch {
      // Malformed source blocks — treat as empty playlist. Same posture as
      // the courses-endpoint helper.
    }
  }
  return []
}

/**
 * Extract the section ids referenced by an exercise's `blocks` playlist.
 * Non-`sectionRef` blocks (rich_text, latex, …) are ignored.
 */
function extractSectionIds(rawBlocks: unknown): string[] {
  const ids: string[] = []
  for (const b of parseBlocks(rawBlocks)) {
    if (b.blockType === 'sectionRef' && typeof b.section === 'string' && b.section) {
      ids.push(b.section)
    }
  }
  return ids
}

/**
 * Clone every section that any pair's source exercise references from its
 * blocks, and rewrite each new exercise's `blocks` field so the sectionRef
 * entries point at the new sections. Sections not present in the DB
 * (dangling refs) are silently skipped — the rewrite step drops those refs
 * so the new exercise doesn't inherit a broken pointer.
 *
 * Section hooks:
 *  - `_skipExerciseBlockSync` is set in `context` so the section
 *    `afterChange` hook doesn't auto-append a duplicate `sectionRef` block
 *    to the new exercise. We rewrite the exercise's `blocks` ourselves in
 *    one final `payload.update` per exercise.
 */
export async function cloneSectionsAndRewireExercises(
  payload: Payload,
  req: PayloadRequest,
  pairs: ExerciseClonePair[],
): Promise<CloneSectionsResult> {
  const sectionIdMap = new Map<string, string>()

  // Reverse index: sourceSectionId → the ExerciseClonePair whose source
  // exercise references it. When a section is referenced from multiple
  // exercises (rare but possible for cross-exercise shared sections), we
  // parent it under the FIRST referencing pair — matching the courses
  // endpoint's `firstReferencingExercise` heuristic.
  const sourceSectionToPair = new Map<string, ExerciseClonePair>()
  const allSectionIds = new Set<string>()
  for (const pair of pairs) {
    for (const secId of extractSectionIds(pair.sourceBlocks)) {
      allSectionIds.add(secId)
      if (!sourceSectionToPair.has(secId)) sourceSectionToPair.set(secId, pair)
    }
  }

  let sectionsCreated = 0
  let sectionsFailed = 0

  if (allSectionIds.size > 0) {
    // Load every referenced section in one query. `limit: 0` returns all
    // matches without pagination; safe because a single lesson rarely has
    // more than a few dozen sections.
    const sourceSectionsRes = await payload.find({
      collection: 'sections',
      where: { id: { in: Array.from(allSectionIds) } },
      limit: 0,
      depth: 0,
      overrideAccess: true,
      req,
    })

    for (const rawSource of sourceSectionsRes.docs) {
      const source = rawSource as unknown as Record<string, unknown> & { id: string }
      const pair = sourceSectionToPair.get(source.id)
      if (!pair) continue // Shouldn't happen — the query was built from the same set.

      const stripped = stripManagedFields(source)
      // Drop legacy denorm fields we're about to overwrite; also clear
      // `translatedFrom` (this is a fresh section, not a translation) and
      // `createdBy` (Payload's createdByField hook will set the current
      // admin — inheriting the source's author would be wrong).
      const {
        adminTitle: _adminTitle,
        translatedFrom: _tf,
        createdBy: _cb,
        exercise: _ex,
        lesson: _ls,
        chapter: _ch,
        course: _co,
        ...rest
      } = stripped as Record<string, unknown>
      void _adminTitle
      void _tf
      void _cb
      void _ex
      void _ls
      void _ch
      void _co

      const newSectionData: Record<string, unknown> = {
        ...rest,
        exercise: pair.newExerciseId,
        lesson: pair.newLessonId,
        chapter: pair.newChapterId,
        course: pair.newCourseId,
      }

      try {
        const created = await payload.create({
          collection: 'sections',
          data: newSectionData as never,
          overrideAccess: true,
          req,
          // Skip the sectionRef auto-append — we set exercise.blocks
          // manually below in one atomic update per exercise.
          context: { _skipExerciseBlockSync: true },
        })
        sectionIdMap.set(source.id, created.id)
        sectionsCreated += 1
      } catch (err) {
        sectionsFailed += 1
        payload.logger.warn(
          `[cloneSectionsAndRewireExercises] skipped section ${source.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
  }

  // Second pass: rewrite each cloned exercise's `blocks` so sectionRef
  // entries point at the new section ids. Refs whose target section didn't
  // clone (missing in DB or create failed) are dropped rather than left
  // pointing at the source section — the whole reason for the deep clone
  // is that the new exercise must not share sections with the source.
  for (const pair of pairs) {
    const originalBlocks = parseBlocks(pair.sourceBlocks)
    if (originalBlocks.length === 0) continue

    const rewritten: BlockRef[] = originalBlocks
      .map((b): BlockRef | null => {
        if (b.blockType !== 'sectionRef') {
          return { ...b, id: b.id ?? newBlockId() }
        }
        if (typeof b.section !== 'string') return null
        const newSectionId = sectionIdMap.get(b.section)
        if (!newSectionId) return null
        return { ...b, id: newBlockId(), section: newSectionId }
      })
      .filter((b): b is BlockRef => b !== null)

    try {
      await payload.update({
        collection: 'exercises',
        id: pair.newExerciseId,
        data: { blocks: JSON.stringify(rewritten) } as never,
        overrideAccess: true,
        req,
        context: { _skipExerciseBlockSync: true },
      })
    } catch (err) {
      payload.logger.warn(
        `[cloneSectionsAndRewireExercises] failed to rewrite blocks on exercise ${pair.newExerciseId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  return { sectionsCreated, sectionsFailed, sectionIdMap }
}
