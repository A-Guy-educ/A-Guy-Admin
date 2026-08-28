/**
 * DELETE /api/cascade-delete?collection=<slug>&id=<id>
 *
 * Cascade-deletes a course, chapter, or lesson and all its descendants.
 *
 * - Lesson:  bulk-delete all exercises → delete the lesson
 * - Chapter: bulk-delete all lessons + exercises → delete the chapter
 * - Course:  bulk-delete all chapters + lessons + exercises → delete the course
 *
 * Access: Admin only.
 *
 * Implementation note: the previous version looped `payload.delete` per
 * descendant. For a 500-exercise course that was 555+ sequential local-API
 * calls over Vercel/Atlas — 5+ minutes and often past Vercel's function
 * ceiling. Each delete also fired the exercise `afterDelete` block-sync
 * hook, which updated a parent lesson that was about to be deleted too:
 * pure waste. This version walks the AUTHORITATIVE parent chain once via
 * bulk `find`, then issues `deleteMany` per collection — 4 DB round-trips
 * total, no per-doc hook overhead. The *target* doc (whatever the caller
 * asked to delete) still goes through `payload.delete` so its own
 * afterDelete hooks fire; that matters for courses, where
 * `cleanupOrphanEntitlements` and `cleanupOrphanEnrollments` clean up
 * unrelated collections.
 *
 * We ONLY traverse authoritative parent refs (chapters.course,
 * lessons.chapter, exercises.lesson). Denorm caches (exercises.chapter,
 * exercises.course, lessons.course) are NEVER used to decide what to
 * delete — a stale denorm on a legit doc is not "belongs to this
 * subtree." Same lesson we relearned in the orphan-cleanup postmortem.
 */
import { ObjectId } from 'mongodb'
import type { Payload, PayloadRequest } from 'payload'

type CollectionSlug = 'courses' | 'chapters' | 'lessons'

type IdForm = string | ObjectId

function toIdForms(id: string): IdForm[] {
  const forms: IdForm[] = [id]
  if (/^[a-f0-9]{24}$/i.test(id)) forms.push(new ObjectId(id))
  return forms
}

/**
 * Access to Payload's underlying Mongo driver — same pattern used by
 * `bulkCreateExercises` and the slug-remap fetch in content-promotion.
 * Driver-typed narrowly to what this endpoint needs; runtime accepts any
 * `_id` shape (string for allowIDOnCreate-imported docs, ObjectId for
 * everything else).
 */
interface MongoLikeCollection {
  find: (
    filter: Record<string, unknown>,
    opts: { projection: Record<string, unknown> },
  ) => { toArray: () => Promise<Array<{ _id: unknown }>> }
  deleteMany: (filter: Record<string, unknown>) => Promise<{ deletedCount?: number }>
}

function mongoCol(payload: Payload, slug: string): MongoLikeCollection | undefined {
  return (
    payload.db as unknown as {
      collections: Record<string, { collection: MongoLikeCollection }>
    }
  ).collections[slug]?.collection
}

async function findIds(
  col: MongoLikeCollection,
  filter: Record<string, unknown>,
): Promise<IdForm[]> {
  const docs = await col.find(filter, { projection: { _id: 1 } }).toArray()
  return docs.map((d) => d._id as IdForm)
}

/**
 * Collects descendant ids of the target doc via authoritative parent refs.
 * The returned lists never include the target itself — the caller deletes
 * that separately through `payload.delete` so its afterDelete hooks fire.
 */
async function collectDescendants(
  payload: Payload,
  collection: CollectionSlug,
  id: string,
): Promise<{ chapterIds: IdForm[]; lessonIds: IdForm[]; exerciseIds: IdForm[] }> {
  const chaptersCol = mongoCol(payload, 'chapters')
  const lessonsCol = mongoCol(payload, 'lessons')
  const exercisesCol = mongoCol(payload, 'exercises')
  if (!chaptersCol || !lessonsCol || !exercisesCol) {
    throw new Error('cascade-delete: required Mongo collections not accessible')
  }

  const targetForms = toIdForms(id)
  let chapterIds: IdForm[] = []
  let lessonIds: IdForm[] = []
  let exerciseIds: IdForm[] = []

  if (collection === 'courses') {
    chapterIds = await findIds(chaptersCol, { course: { $in: targetForms } })
    if (chapterIds.length > 0) {
      lessonIds = await findIds(lessonsCol, { chapter: { $in: chapterIds } })
    }
    if (lessonIds.length > 0) {
      exerciseIds = await findIds(exercisesCol, { lesson: { $in: lessonIds } })
    }
    return { chapterIds, lessonIds, exerciseIds }
  }

  if (collection === 'chapters') {
    // The target chapter itself isn't in `chapterIds` — the caller deletes
    // it via payload.delete. We just gather its lesson+exercise subtree.
    lessonIds = await findIds(lessonsCol, { chapter: { $in: targetForms } })
    if (lessonIds.length > 0) {
      exerciseIds = await findIds(exercisesCol, { lesson: { $in: lessonIds } })
    }
    return { chapterIds: [], lessonIds, exerciseIds }
  }

  // lessons
  exerciseIds = await findIds(exercisesCol, { lesson: { $in: targetForms } })
  return { chapterIds: [], lessonIds: [], exerciseIds }
}

async function bulkCascadeDelete(
  req: PayloadRequest,
  collection: CollectionSlug,
  id: string,
): Promise<{ chapters: number; lessons: number; exercises: number }> {
  const { payload } = req
  const { chapterIds, lessonIds, exerciseIds } = await collectDescendants(payload, collection, id)

  const exercisesCol = mongoCol(payload, 'exercises')
  const lessonsCol = mongoCol(payload, 'lessons')
  const chaptersCol = mongoCol(payload, 'chapters')
  if (!exercisesCol || !lessonsCol || !chaptersCol) {
    throw new Error('cascade-delete: required Mongo collections not accessible')
  }

  // Bottom-up: a mid-run failure leaves parents dangling rather than
  // orphaning children of a still-live parent (recoverable via the orphan
  // sweep). Casts around `$in` because our promoted collections have mixed
  // `_id` shapes (ObjectId for docs written through the local API, string
  // for content-promotion-imported docs with allowIDOnCreate + text
  // idType) — driver types default to ObjectId-only but the runtime
  // accepts both.
  const idIn = (ids: IdForm[]): Record<string, unknown> => ({ _id: { $in: ids } })
  const counts = { chapters: 0, lessons: 0, exercises: 0 }
  if (exerciseIds.length > 0) {
    const r = await exercisesCol.deleteMany(idIn(exerciseIds))
    counts.exercises = r.deletedCount ?? 0
  }
  if (lessonIds.length > 0) {
    const r = await lessonsCol.deleteMany(idIn(lessonIds))
    counts.lessons = r.deletedCount ?? 0
  }
  if (chapterIds.length > 0) {
    const r = await chaptersCol.deleteMany(idIn(chapterIds))
    counts.chapters = r.deletedCount ?? 0
  }
  return counts
}

const ALLOWED_COLLECTIONS: CollectionSlug[] = ['courses', 'chapters', 'lessons']

export async function cascadeDeleteEndpoint(req: PayloadRequest): Promise<Response> {
  // 1) Auth — admin only
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  // 2) Parse params
  const url = new URL(req.url || 'http://localhost')
  const collection = url.searchParams.get('collection') as CollectionSlug | null
  const id = url.searchParams.get('id')

  if (!collection || !id) {
    return Response.json(
      { error: 'Both "collection" and "id" query parameters are required' },
      { status: 400 },
    )
  }

  if (!ALLOWED_COLLECTIONS.includes(collection)) {
    return Response.json(
      { error: `Invalid collection. Allowed: ${ALLOWED_COLLECTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  // 3) Verify the target document exists
  try {
    await req.payload.findByID({
      collection,
      id,
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch {
    return Response.json(
      { error: `${collection} document with id "${id}" not found` },
      { status: 404 },
    )
  }

  // 4) Bulk-delete the descendant subtree via raw driver, then delete the
  //    target through payload.delete so its own afterDelete hooks fire.
  try {
    const startedAt = Date.now()
    const descendantCounts = await bulkCascadeDelete(req, collection, id)
    await req.payload.delete({ collection, id, overrideAccess: true, req })

    const totalDeleted =
      1 + descendantCounts.chapters + descendantCounts.lessons + descendantCounts.exercises
    const durationMs = Date.now() - startedAt

    const parts = [
      descendantCounts.chapters ? `${descendantCounts.chapters} chapter(s)` : null,
      descendantCounts.lessons ? `${descendantCounts.lessons} lesson(s)` : null,
      descendantCounts.exercises ? `${descendantCounts.exercises} exercise(s)` : null,
    ].filter(Boolean) as string[]
    const descendantSummary = parts.length > 0 ? parts.join(', ') : 'no descendants'

    return Response.json({
      success: true,
      message: `Cascade deleted ${collection} "${id}" and ${totalDeleted - 1} descendant(s) — ${descendantSummary} in ${durationMs}ms`,
      totalDeleted,
      descendantCounts,
      durationMs,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: `Cascade delete failed: ${message}` }, { status: 500 })
  }
}
