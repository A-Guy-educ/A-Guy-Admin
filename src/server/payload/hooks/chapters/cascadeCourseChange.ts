/**
 * cascadeCourseChange — afterChange hook on Chapters.
 *
 * @fileType hook
 * @domain chapters
 * @pattern denormalized-fk-cascade
 * @ai-summary When a chapter's `course` FK changes, update every descendant lesson/exercise/section's own `course` FK to match.
 *
 * Lessons, exercises, and sections each carry a denormalized `course` FK (set
 * by their own beforeChange hooks on write — see Lessons.ts beforeChange hook
 * at the `Auto-populate course from chapter` block). The admin UIs filter the
 * respective list views by that FK directly for performance (see
 * CourseLessonsSorter which queries `where[course][equals]: id`).
 *
 * Without this cascade, moving a chapter from course A to course B would leave
 * every descendant with `course: A`, so:
 *   - The old course's "lessons" list still shows them.
 *   - The new course's "lessons" list doesn't.
 *   - Any read-path code that trusts the denormalized FK (not just the admin
 *     list) sees the stale value.
 *
 * We use raw Mongo `updateMany` instead of iterating `payload.update` for two
 * reasons:
 *   - A chapter can have hundreds of descendants; per-doc updates with hook
 *     re-runs would be slow and would re-trigger the same beforeChange hook
 *     cycle on each child.
 *   - The hook we would retrigger is exactly the one that denormalizes
 *     `course` from the parent — which is what we're doing manually here,
 *     one layer up. Running it again per-child is wasted work.
 *
 * `adminTitle` on each descendant is NOT recomputed by this hook — doing so
 * would require fetching the new course's title and rebuilding each child's
 * title string in-memory. The denormalized FK (the thing that drives list
 * filters) is corrected immediately; the adminTitle breadcrumb heals on the
 * child's next save. Mentioned in PR notes so admins know the admin title
 * stays stale until re-edit.
 *
 * We're intentionally only cascading on `course` change — not on arbitrary
 * chapter edits — because the hook is also entered on every chapter save
 * (title, order, slug tweaks, etc.) and running three `updateMany` calls per
 * save would be gratuitous.
 */
import type { CollectionAfterChangeHook } from 'payload'
import { ObjectId } from 'mongodb'

type ChapterLike = { id: string; course?: unknown }

/** Resolve a possibly-populated relationship into a plain id string. */
function toIdString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

/** Convert a 24-hex string to ObjectId; return the string unchanged otherwise. */
function toObjectIdIfHex(value: string): ObjectId | string {
  if (!/^[a-f0-9]{24}$/i.test(value)) return value
  try {
    return new ObjectId(value)
  } catch {
    return value
  }
}

export const cascadeCourseChange: CollectionAfterChangeHook<ChapterLike> = async ({
  operation,
  doc,
  previousDoc,
  req,
}) => {
  if (operation !== 'update') return doc

  const prevCourseId = toIdString(previousDoc?.course)
  const nextCourseId = toIdString(doc?.course)
  if (!nextCourseId || prevCourseId === nextCourseId) return doc

  const chapterIdString = toIdString(doc.id) ?? String(doc.id)
  const chapterId = toObjectIdIfHex(chapterIdString)
  const courseId = toObjectIdIfHex(nextCourseId)

  // Raw mongo updateMany per child collection. Access the native Mongo
  // collection via Payload's db adapter — same pattern used by
  // duplicateCourseEndpoint for bulk inserts.
  const mongoCollections = (
    req.payload.db as unknown as {
      collections: Record<
        string,
        {
          collection: {
            updateMany: (
              filter: Record<string, unknown>,
              update: Record<string, unknown>,
            ) => Promise<{ matchedCount?: number; modifiedCount?: number }>
          }
        }
      >
    }
  ).collections

  const targets: Array<'lessons' | 'exercises' | 'sections'> = ['lessons', 'exercises', 'sections']
  const results: Record<string, { matched: number; modified: number } | { error: string }> = {}
  const failures: Array<{ slug: string; error: string }> = []

  // Best-effort: run every updateMany even if an earlier one failed, so we
  // minimize the split-brain window. Collect failures and surface them at the
  // end — do NOT silently swallow (previous version did and left the chapter
  // on course B with descendants partially on A).
  for (const slug of targets) {
    const mongo = mongoCollections[slug]?.collection
    if (!mongo) {
      const msg = 'collection not found on payload.db'
      results[slug] = { error: msg }
      failures.push({ slug, error: msg })
      continue
    }
    try {
      const res = await mongo.updateMany(
        { chapter: chapterId },
        { $set: { course: courseId, updatedAt: new Date() } },
      )
      results[slug] = {
        matched: res.matchedCount ?? 0,
        modified: res.modifiedCount ?? 0,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'updateMany failed'
      results[slug] = { error: msg }
      failures.push({ slug, error: msg })
    }
  }

  if (failures.length > 0) {
    // Log at error so ops dashboards pick it up, then throw to surface the
    // failure to the admin via the HTTP response. The chapter.course update
    // itself has already been committed (we're in afterChange), so re-saving
    // the chapter won't re-trigger this hook — the prevCourseId === nextCourseId
    // guard will skip. The admin's recovery path is to run the backfill
    // (sync-chapter-descendants, future endpoint) or edit a descendant lesson
    // directly to retrigger its own beforeChange, which re-derives `course`
    // from the chapter. Known-tracked tradeoff; good-enough until retries are
    // automated.
    req.payload.logger.error(
      {
        chapterId: chapterIdString,
        from: prevCourseId,
        to: nextCourseId,
        results,
        failures,
      },
      '[chapters.cascadeCourseChange] partial failure — descendant course FKs may be split-brain',
    )
    throw new Error(
      `Chapter move cascade failed on ${failures.map((f) => f.slug).join(', ')}: ${failures
        .map((f) => `${f.slug}=${f.error}`)
        .join('; ')}`,
    )
  }

  req.payload.logger.info(
    {
      chapterId: chapterIdString,
      from: prevCourseId,
      to: nextCourseId,
      results,
    },
    '[chapters.cascadeCourseChange] moved chapter to new course',
  )

  return doc
}
