/**
 * Bulk-clone a course or chapter subtree via raw Mongo `insertMany`.
 *
 * @fileType service
 * @domain duplication
 * @pattern duplication-bulk-insert
 * @ai-summary Shared bulk-insert engine for the course and chapter duplicate endpoints.
 *
 * PERFORMANCE — raw `insertMany` instead of `payload.create`.
 *
 * `payload.create` serializes every doc through the Mongoose adapter + Payload
 * hooks + validators. On a Vercel serverless function with `maxPoolSize: 3`
 * that becomes thousands of sequential round trips — ~1 hour wall time for a
 * 60-lesson course clone, ~40 minutes for a 40-lesson chapter clone.
 *
 * This engine grabs the raw Mongo collection off
 * `payload.db.collections[X].collection` and calls
 * `insertMany(docs, { ordered: false })` — one round trip per collection,
 * hundreds or thousands of docs per call. Sub-second write phase.
 *
 * Bypassing hooks + validators means we reproduce what they would have done:
 *   - id remap: pre-generate fresh ObjectIds, build source→new maps per
 *     collection, rewrite every FK + block ref before the insert
 *   - relationship fields → ObjectId (so Payload reads cast their query ids
 *     to ObjectId and still match)
 *   - createdAt/updatedAt → real Date objects
 *   - `id` (Payload virtual) stripped; `_id` set to the pre-generated id
 *   - slugs pre-computed unique for globally-unique indexes (chapters, lessons):
 *     `{baseSlug}-copy-{suffix}`
 *   - adminTitle breadcrumbs assembled in-memory
 *   - lesson.blocks[].exercise + exercise.blocks[].section rewired via the id
 *     maps so the clone has its own playlist DAG
 *   - block ids inside those playlists regenerated so admins editing one copy
 *     don't overwrite the other via id collision
 *   - createdBy → the duplicating admin (not source's author)
 *   - translatedFrom cleared — the duplicate is a fresh doc, not a translation
 *
 * The top-level doc (course or chapter) is created by the caller via
 * `payload.create` — single-doc hook validation is worth keeping for the root
 * record. Only the children go through this bulk path.
 *
 * Two public entry points:
 *   - `cloneCourseTree` — chapters + lessons + exercises + sections
 *   - `cloneChapterTree` — lessons + exercises + sections (chapter already
 *     created by the caller; the course FK stays the same, since a chapter
 *     clone lives in the same course as its source)
 */
import { ObjectId } from 'mongodb'

import type { Payload, PayloadRequest, Where } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'
import { regenerateBlockIds } from './regenerate-block-ids'

/**
 * Batch limits for `insertMany`. `INSERT_MANY_MAX_DOCS` is the doc-count cap;
 * `INSERT_MANY_MAX_BYTES` is a conservative ceiling well under Mongo's 16 MB
 * per-request limit. Sections carrying base64-embedded media in `content` can
 * push individual docs into the MB range, so batching only by doc count would
 * let a single unlucky batch balloon past 16 MB — and MongoDB rejects the
 * whole request, marking every doc in the batch as failed even if only one
 * was oversized. Cap by both.
 */
const INSERT_MANY_MAX_DOCS = 500
const INSERT_MANY_MAX_BYTES = 8 * 1024 * 1024
const FIND_PAGE_SIZE = 500

/** Random 12-char base36 id for playlist blocks. */
function newBlockId(): string {
  return Math.random().toString(36).slice(2, 14)
}

/** Join non-empty parts with " / " — mirrors computeSectionAdminTitle. */
function joinBreadcrumb(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' / ')
}

/** Convert a 24-hex string to ObjectId; leave anything else untouched. */
function toObjectIdIfHex(value: unknown): unknown {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) return value
  try {
    return new ObjectId(value)
  } catch {
    return value
  }
}

/** Coerce a value to a Date; return `undefined` for unusable inputs. */
function coerceToDate(value: unknown): Date | undefined {
  if (value == null) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return undefined
}

/** Convert every entry in a relationship field to ObjectId (handles hasMany). */
function toObjectIdRelation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toObjectIdIfHex)
  return toObjectIdIfHex(value)
}

/**
 * Fields on child collections that must be ObjectId-typed at rest. Payload's
 * Mongoose adapter casts these during `payload.create`; raw `insertMany`
 * doesn't, so a doc left with a 24-hex string here won't match later
 * `find({ where: { <field>: <someId> } })` queries whose values get cast to
 * ObjectId. Must include every relationship / upload field across chapters,
 * lessons, exercises, sections. Adding a field to the schemas without adding
 * it here silently breaks read-path population.
 */
const COMMON_RELATIONSHIP_FIELDS = [
  'tenant',
  'translatedFrom',
  'createdBy',
  'course',
  'chapter',
  'lesson',
  'exercise',
  'categories',
  'prompt',
  'formulaSheet',
  'mediaFiles',
  'prerequisites',
  'nextLessons',
  'contentFiles',
  'sourceDoc',
] as const

/**
 * Coerce nested relationship fields that don't live at the doc root — e.g.
 * `meta.image` is a group-nested media upload on lessons.
 */
function coerceNestedRelationships(doc: Record<string, unknown>): void {
  const meta = doc.meta
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const metaObj = meta as Record<string, unknown>
    if (metaObj.image !== undefined && metaObj.image !== null) {
      metaObj.image = toObjectIdRelation(metaObj.image)
    }
  }
}

/**
 * Coerce every relationship field on a doc to `ObjectId`, plus common date
 * fields. Mutates `doc` in place and returns it for chaining.
 */
function coerceRelationshipsAndDates(doc: Record<string, unknown>): Record<string, unknown> {
  for (const field of COMMON_RELATIONSHIP_FIELDS) {
    if (doc[field] !== undefined && doc[field] !== null) {
      doc[field] = toObjectIdRelation(doc[field])
    }
  }
  coerceNestedRelationships(doc)
  const now = new Date()
  doc.createdAt = coerceToDate(doc.createdAt) ?? now
  doc.updatedAt = coerceToDate(doc.updatedAt) ?? now
  return doc
}

interface BlockRef {
  id?: string
  blockType?: string
  exercise?: string
  section?: string
  [key: string]: unknown
}

/** Parse a JSON-string-or-array `blocks` field into a typed list. */
function parseBlocks(raw: unknown): BlockRef[] {
  if (Array.isArray(raw)) return raw as BlockRef[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockRef[]
    } catch {
      // Malformed source blocks — treat as empty playlist.
    }
  }
  return []
}

/** Extract all exercise ids referenced in a lesson's blocks playlist. */
function collectExerciseRefIds(rawBlocks: unknown): string[] {
  const ids: string[] = []
  for (const b of parseBlocks(rawBlocks)) {
    if (b.blockType === 'exerciseRef' && typeof b.exercise === 'string') {
      ids.push(b.exercise)
    }
  }
  return ids
}

/** Extract all section ids referenced in an exercise's blocks playlist. */
function collectSectionRefIds(rawBlocks: unknown): string[] {
  const ids: string[] = []
  for (const b of parseBlocks(rawBlocks)) {
    if (b.blockType === 'sectionRef' && typeof b.section === 'string') {
      ids.push(b.section)
    }
  }
  return ids
}

/** Read every page of docs matching the filter (Payload's default limit truncates). */
async function findAllPages<T extends { id: string }>(
  payload: Payload,
  req: PayloadRequest,
  collection: 'chapters' | 'lessons' | 'exercises' | 'sections',
  where: Where,
): Promise<T[]> {
  const results: T[] = []
  let page = 1
  for (;;) {
    const res = await payload.find({
      collection,
      where,
      limit: FIND_PAGE_SIZE,
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

interface BulkInsertItem {
  sourceId: string
  /**
   * Source id of the parent doc in the hierarchy. The insert pipeline uses this
   * to skip children whose parent didn't land — otherwise a child would sit
   * with an FK pointing at nothing.
   */
  parentSourceId?: string
  doc: Record<string, unknown>
}

interface BulkInsertResult {
  inserted: number
  failed: number
  failures: Array<{ sourceId: string; message: string }>
  failedSourceIds: Set<string>
}

/**
 * Split items into batches that respect both doc-count and byte-size budgets.
 * A single doc that on its own exceeds the byte budget still gets its own
 * batch — that way an oversized section blows up alone instead of taking 499
 * healthy siblings with it.
 */
function splitByBudget(items: BulkInsertItem[]): BulkInsertItem[][] {
  const batches: BulkInsertItem[][] = []
  let current: BulkInsertItem[] = []
  let currentBytes = 0
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item.doc))
    if (
      current.length > 0 &&
      (current.length >= INSERT_MANY_MAX_DOCS || currentBytes + size > INSERT_MANY_MAX_BYTES)
    ) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(item)
    currentBytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Insert `items` with `ordered: false` so a per-doc failure doesn't kill the
 * rest of the batch. `sourceId` on each item lets the caller filter downstream
 * collections whose ancestor failed to insert.
 */
async function bulkInsert(
  payload: Payload,
  collectionSlug: 'chapters' | 'lessons' | 'exercises' | 'sections',
  items: BulkInsertItem[],
): Promise<BulkInsertResult> {
  if (items.length === 0) {
    return { inserted: 0, failed: 0, failures: [], failedSourceIds: new Set() }
  }

  const mongoCollection = (
    payload.db as unknown as {
      collections: Record<
        string,
        {
          collection: {
            insertMany: (
              docs: Array<Record<string, unknown>>,
              opts: { ordered: false },
            ) => Promise<{ insertedCount?: number }>
          }
        }
      >
    }
  ).collections[collectionSlug].collection

  let inserted = 0
  let failed = 0
  const failures: Array<{ sourceId: string; message: string }> = []
  const failedSourceIds = new Set<string>()

  for (const batch of splitByBudget(items)) {
    try {
      const res = await mongoCollection.insertMany(
        batch.map((b) => b.doc),
        { ordered: false },
      )
      inserted += res.insertedCount ?? batch.length
    } catch (error) {
      const bulkErr = error as {
        writeErrors?: Array<{ index: number; errmsg?: string }>
        insertedCount?: number
      }
      if (Array.isArray(bulkErr.writeErrors)) {
        const batchFailedIdx = new Set<number>()
        for (const we of bulkErr.writeErrors) {
          batchFailedIdx.add(we.index)
          failed += 1
          const src = batch[we.index]?.sourceId ?? '<unknown>'
          failures.push({ sourceId: src, message: we.errmsg ?? 'insert failed' })
          failedSourceIds.add(src)
        }
        for (let i = 0; i < batch.length; i++) {
          if (!batchFailedIdx.has(i)) inserted += 1
        }
      } else {
        const msg = error instanceof Error ? error.message : 'Unknown bulk insert error'
        for (const item of batch) {
          failed += 1
          failures.push({ sourceId: item.sourceId, message: msg })
          failedSourceIds.add(item.sourceId)
        }
      }
    }
  }

  return { inserted, failed, failures, failedSourceIds }
}

// ---------------------------------------------------------------------------
// Prepare per-collection docs. Each function returns the raw doc ready for
// `insertMany` (new _id, remapped FKs, pre-computed slug/adminTitle).
// ---------------------------------------------------------------------------

interface CourseTitles {
  newCourseTitle: string
}

interface ChapterCtx {
  newId: ObjectId
  chapterTitle: string
}

interface LessonCtx {
  newId: ObjectId
  newChapterId: ObjectId
  chapterTitle: string
  lessonTitle: string
}

interface ExerciseCtx {
  newId: ObjectId
  newLessonId: ObjectId
  newChapterId: ObjectId
  chapterTitle: string
  lessonTitle: string
  exerciseTitle: string
}

/**
 * Build an insert-ready chapter doc. Only used in course mode (chapter mode
 * creates the chapter inline via `payload.create` before the engine runs).
 */
function prepareChapter(
  source: Record<string, unknown> & { id: string },
  ctx: ChapterCtx,
  newCourseObjectId: ObjectId,
  slugSuffix: string,
  titles: CourseTitles,
  createdByObjectId: ObjectId | null,
): Record<string, unknown> {
  const { id: _id, createdAt: _c, updatedAt: _u, adminTitle: _a, ...rest } = source
  void _id
  void _c
  void _u
  void _a

  const sourceSlug = typeof rest.slug === 'string' ? rest.slug : ''
  const baseSlug = sourceSlug.trim() || formatSlug(ctx.chapterTitle)

  const doc: Record<string, unknown> = {
    ...rest,
    _id: ctx.newId,
    course: newCourseObjectId,
    slug: `${baseSlug}-copy-${slugSuffix}`,
    status: 'draft',
    adminTitle: `${ctx.chapterTitle} — ${titles.newCourseTitle}`,
    translatedFrom: null,
    createdBy: createdByObjectId,
  }
  return coerceRelationshipsAndDates(doc)
}

/**
 * Build an insert-ready lesson doc. `blocks` is rewritten with the new
 * exercise ids from `exerciseIdMap`; entries whose target exercise wasn't
 * prepared are dropped so the new lesson doesn't hold dangling refs.
 */
function prepareLesson(
  source: Record<string, unknown> & { id: string },
  ctx: LessonCtx,
  newCourseObjectId: ObjectId,
  slugSuffix: string,
  titles: CourseTitles,
  exerciseIdMap: Map<string, ObjectId>,
  preparedExerciseIds: Set<string>,
  createdByObjectId: ObjectId | null,
): Record<string, unknown> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    adminTitle: _a,
    blocks: rawBlocks,
    ...rest
  } = source as Record<string, unknown>
  void _id
  void _c
  void _u
  void _a

  const lessonTitle = ctx.lessonTitle
  const sourceSlug = typeof rest.slug === 'string' ? rest.slug : ''
  const baseSlug = sourceSlug.trim() || formatSlug(lessonTitle)

  // Rebuild the lesson.blocks[] playlist with the new exercise ids. Non-
  // exerciseRef blocks (rich_text, etc.) are preserved verbatim. An
  // exerciseRef whose target ISN'T in preparedExerciseIds is dropped —
  // otherwise the new lesson would point at an ObjectId that was assigned
  // but never inserted.
  const rebuiltBlocks: BlockRef[] = parseBlocks(rawBlocks)
    .map((b): BlockRef | null => {
      if (b.blockType !== 'exerciseRef') return { ...b, id: newBlockId() }
      if (typeof b.exercise !== 'string') return null
      if (!preparedExerciseIds.has(b.exercise)) return null
      const newExId = exerciseIdMap.get(b.exercise)
      if (!newExId) return null
      return { ...b, id: newBlockId(), exercise: newExId.toString() }
    })
    .filter((b): b is BlockRef => b !== null)

  const doc: Record<string, unknown> = {
    ...rest,
    _id: ctx.newId,
    chapter: ctx.newChapterId,
    course: newCourseObjectId,
    slug: `${baseSlug}-copy-${slugSuffix}`,
    status: 'draft',
    adminTitle: joinBreadcrumb([titles.newCourseTitle, ctx.chapterTitle, lessonTitle]),
    blocks: JSON.stringify(rebuiltBlocks),
    translatedFrom: null,
    createdBy: createdByObjectId,
  }
  return coerceRelationshipsAndDates(doc)
}

/** Build an insert-ready exercise doc with rewired section refs. */
function prepareExercise(
  source: Record<string, unknown> & { id: string },
  ctx: ExerciseCtx,
  newCourseObjectId: ObjectId,
  sectionIdMap: Map<string, ObjectId>,
  preparedSectionIds: Set<string>,
  createdByObjectId: ObjectId | null,
): Record<string, unknown> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    blocks: rawBlocks,
    ...rest
  } = source as Record<string, unknown>
  void _id
  void _c
  void _u

  const rebuiltBlocks: BlockRef[] = parseBlocks(rawBlocks)
    .map((b): BlockRef | null => {
      if (b.blockType !== 'sectionRef') return { ...b, id: newBlockId() }
      if (typeof b.section !== 'string') return null
      if (!preparedSectionIds.has(b.section)) return null
      const newSecId = sectionIdMap.get(b.section)
      if (!newSecId) return null
      return { ...b, id: newBlockId(), section: newSecId.toString() }
    })
    .filter((b): b is BlockRef => b !== null)

  const doc: Record<string, unknown> = {
    ...rest,
    _id: ctx.newId,
    lesson: ctx.newLessonId,
    chapter: ctx.newChapterId,
    course: newCourseObjectId,
    blocks: JSON.stringify(rebuiltBlocks),
    translatedFrom: null,
    createdBy: createdByObjectId,
  }
  return coerceRelationshipsAndDates(doc)
}

/**
 * Build an insert-ready section doc. adminTitle is the 5-level breadcrumb
 * computeSectionAdminTitle would have produced; per-doc block ids inside
 * content.blocks are regenerated so admins editing one copy don't trample
 * the other via id collision.
 */
function prepareSection(
  source: Record<string, unknown> & { id: string },
  newSectionObjectId: ObjectId,
  newExerciseObjectId: ObjectId,
  newLessonObjectId: ObjectId,
  newChapterObjectId: ObjectId,
  newCourseObjectId: ObjectId,
  titles: CourseTitles,
  chapterTitle: string,
  lessonTitle: string,
  exerciseTitle: string,
  createdByObjectId: ObjectId | null,
): Record<string, unknown> {
  const { id: _id, createdAt: _c, updatedAt: _u, adminTitle: _a, ...rest } = source
  void _id
  void _c
  void _u
  void _a

  const sectionTitle = typeof rest.title === 'string' ? rest.title : ''
  const rewrittenContent = regenerateBlockIds((rest as { content?: unknown }).content)
  const doc: Record<string, unknown> = {
    ...rest,
    content: rewrittenContent,
    _id: newSectionObjectId,
    exercise: newExerciseObjectId,
    lesson: newLessonObjectId,
    chapter: newChapterObjectId,
    course: newCourseObjectId,
    adminTitle: joinBreadcrumb([
      titles.newCourseTitle,
      chapterTitle,
      lessonTitle,
      exerciseTitle,
      sectionTitle,
    ]),
    translatedFrom: null,
    createdBy: createdByObjectId,
  }
  return coerceRelationshipsAndDates(doc)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BulkCloneCounts {
  chaptersCloned: number
  chaptersFailed: number
  lessonsCloned: number
  lessonsFailed: number
  exercisesCloned: number
  exercisesFailed: number
  sectionsCloned: number
  sectionsFailed: number
}

export interface CloneCourseTreeInput {
  sourceCourseId: string
  newCourseObjectId: ObjectId
  newCourseTitle: string
  createdByObjectId: ObjectId | null
  slugSuffix: string
}

/**
 * Clone every chapter, lesson, exercise, and section under `sourceCourseId`
 * into the already-created `newCourseObjectId`. The caller is responsible for
 * creating the course doc itself.
 */
export async function cloneCourseTree(
  req: PayloadRequest,
  input: CloneCourseTreeInput,
): Promise<BulkCloneCounts> {
  const { sourceCourseId, newCourseObjectId, newCourseTitle, createdByObjectId, slugSuffix } = input
  const titles: CourseTitles = { newCourseTitle }

  // 1) Parallel load every child under the source course.
  const [sourceChapters, sourceLessonsFK, sourceExercisesFK, sourceSectionsFK] = await Promise.all([
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'chapters', {
      course: { equals: sourceCourseId },
    }),
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'lessons', {
      course: { equals: sourceCourseId },
    }),
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'exercises', {
      course: { equals: sourceCourseId },
    }),
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'sections', {
      course: { equals: sourceCourseId },
    }),
  ])

  // 2a) Cross-course reference healing — union lesson.blocks[].exercise.
  const knownExerciseIds = new Set(sourceExercisesFK.map((e) => e.id))
  const missingExerciseIds: string[] = []
  const firstReferencingLesson = new Map<string, string>()
  for (const lesson of sourceLessonsFK) {
    for (const exId of collectExerciseRefIds(lesson.blocks)) {
      if (!firstReferencingLesson.has(exId)) firstReferencingLesson.set(exId, lesson.id)
      if (!knownExerciseIds.has(exId)) {
        knownExerciseIds.add(exId)
        missingExerciseIds.push(exId)
      }
    }
  }
  const extraExercises: Array<Record<string, unknown> & { id: string }> = []
  if (missingExerciseIds.length > 0) {
    const extra = await findAllPages<Record<string, unknown> & { id: string }>(
      req.payload,
      req,
      'exercises',
      { id: { in: missingExerciseIds } },
    )
    extraExercises.push(...extra)
  }
  const sourceExercises = [...sourceExercisesFK, ...extraExercises]

  // 2b) Same union pattern for sections referenced from exercise.blocks.
  const knownSectionIds = new Set(sourceSectionsFK.map((s) => s.id))
  const missingSectionIds: string[] = []
  const firstReferencingExercise = new Map<string, string>()
  for (const exercise of sourceExercises) {
    for (const secId of collectSectionRefIds(exercise.blocks)) {
      if (!firstReferencingExercise.has(secId)) firstReferencingExercise.set(secId, exercise.id)
      if (!knownSectionIds.has(secId)) {
        knownSectionIds.add(secId)
        missingSectionIds.push(secId)
      }
    }
  }
  const extraSections: Array<Record<string, unknown> & { id: string }> = []
  if (missingSectionIds.length > 0) {
    const extra = await findAllPages<Record<string, unknown> & { id: string }>(
      req.payload,
      req,
      'sections',
      { id: { in: missingSectionIds } },
    )
    extraSections.push(...extra)
  }
  const sourceSections = [...sourceSectionsFK, ...extraSections]

  // 3) Pre-generate new ObjectIds for every child.
  const chapterIdMap = new Map<string, ObjectId>()
  const lessonIdMap = new Map<string, ObjectId>()
  const exerciseIdMap = new Map<string, ObjectId>()
  const sectionIdMap = new Map<string, ObjectId>()
  for (const c of sourceChapters) chapterIdMap.set(c.id, new ObjectId())
  for (const l of sourceLessonsFK) lessonIdMap.set(l.id, new ObjectId())
  for (const e of sourceExercises) exerciseIdMap.set(e.id, new ObjectId())
  for (const s of sourceSections) sectionIdMap.set(s.id, new ObjectId())

  // Lookup tables for title / hierarchy resolution during prep.
  const chapterTitleById = new Map<string, string>()
  for (const c of sourceChapters) {
    chapterTitleById.set(c.id, typeof c.title === 'string' ? c.title : 'Untitled')
  }
  const lessonMetaById = new Map<
    string,
    { title: string; chapterId: string | null; chapterTitle: string }
  >()
  for (const l of sourceLessonsFK) {
    const lChapterId = typeof l.chapter === 'string' ? l.chapter : null
    lessonMetaById.set(l.id, {
      title: typeof l.title === 'string' ? l.title : 'Untitled',
      chapterId: lChapterId,
      chapterTitle: (lChapterId && chapterTitleById.get(lChapterId)) || '',
    })
  }
  const exerciseMetaById = new Map<
    string,
    { title: string; lessonId: string | null; chapterId: string | null }
  >()
  for (const e of sourceExercises) {
    exerciseMetaById.set(e.id, {
      title: typeof e.title === 'string' ? e.title : '',
      lessonId: typeof e.lesson === 'string' ? e.lesson : null,
      chapterId: typeof e.chapter === 'string' ? e.chapter : null,
    })
  }

  // 4a) Sections.
  const sectionItems: BulkInsertItem[] = []
  const preparedSectionIds = new Set<string>()
  for (const s of sourceSections) {
    const newId = sectionIdMap.get(s.id) as ObjectId
    let parentExId =
      typeof s.exercise === 'string' && exerciseMetaById.has(s.exercise) ? s.exercise : null
    if (!parentExId || !exerciseMetaById.get(parentExId)?.lessonId) {
      const referencingExId = firstReferencingExercise.get(s.id)
      if (referencingExId && exerciseMetaById.has(referencingExId)) {
        parentExId = referencingExId
      } else {
        continue
      }
    }
    const exMeta = exerciseMetaById.get(parentExId)
    if (!exMeta) continue
    let parentLessonId: string | null = null
    if (exMeta.lessonId && lessonMetaById.has(exMeta.lessonId)) {
      parentLessonId = exMeta.lessonId
    } else {
      const refLesson = firstReferencingLesson.get(parentExId)
      if (refLesson && lessonMetaById.has(refLesson)) parentLessonId = refLesson
    }
    if (!parentLessonId) continue
    const lessonMeta = lessonMetaById.get(parentLessonId)
    if (!lessonMeta || !lessonMeta.chapterId) continue
    const newExerciseId = exerciseIdMap.get(parentExId)
    const newLessonId = lessonIdMap.get(parentLessonId)
    const newChapterId = chapterIdMap.get(lessonMeta.chapterId)
    if (!newExerciseId || !newLessonId || !newChapterId) continue

    sectionItems.push({
      sourceId: s.id,
      parentSourceId: parentExId,
      doc: prepareSection(
        s,
        newId,
        newExerciseId,
        newLessonId,
        newChapterId,
        newCourseObjectId,
        titles,
        lessonMeta.chapterTitle,
        lessonMeta.title,
        exMeta.title,
        createdByObjectId,
      ),
    })
    preparedSectionIds.add(s.id)
  }

  // 4b) Exercises.
  const exerciseItems: BulkInsertItem[] = []
  const preparedExerciseIds = new Set<string>()
  for (const e of sourceExercises) {
    const newId = exerciseIdMap.get(e.id) as ObjectId
    const meta = exerciseMetaById.get(e.id)
    if (!meta) continue
    let parentLessonId: string | null = null
    if (meta.lessonId && lessonMetaById.has(meta.lessonId)) {
      parentLessonId = meta.lessonId
    } else {
      const refLesson = firstReferencingLesson.get(e.id)
      if (refLesson && lessonMetaById.has(refLesson)) parentLessonId = refLesson
    }
    if (!parentLessonId) continue
    const lessonMeta = lessonMetaById.get(parentLessonId)
    if (!lessonMeta || !lessonMeta.chapterId) continue
    const newLessonId = lessonIdMap.get(parentLessonId)
    const newChapterId = chapterIdMap.get(lessonMeta.chapterId)
    if (!newLessonId || !newChapterId) continue

    exerciseItems.push({
      sourceId: e.id,
      parentSourceId: parentLessonId,
      doc: prepareExercise(
        e,
        {
          newId,
          newLessonId,
          newChapterId,
          chapterTitle: lessonMeta.chapterTitle,
          lessonTitle: lessonMeta.title,
          exerciseTitle: meta.title,
        },
        newCourseObjectId,
        sectionIdMap,
        preparedSectionIds,
        createdByObjectId,
      ),
    })
    preparedExerciseIds.add(e.id)
  }

  // 4c) Lessons.
  const lessonItems: BulkInsertItem[] = []
  for (const l of sourceLessonsFK) {
    const newId = lessonIdMap.get(l.id) as ObjectId
    const meta = lessonMetaById.get(l.id)
    if (!meta || !meta.chapterId) continue
    const newChapterId = chapterIdMap.get(meta.chapterId)
    if (!newChapterId) continue
    lessonItems.push({
      sourceId: l.id,
      parentSourceId: meta.chapterId,
      doc: prepareLesson(
        l,
        {
          newId,
          newChapterId,
          chapterTitle: meta.chapterTitle,
          lessonTitle: meta.title,
        },
        newCourseObjectId,
        slugSuffix,
        titles,
        exerciseIdMap,
        preparedExerciseIds,
        createdByObjectId,
      ),
    })
  }

  // 4d) Chapters.
  const chapterItems: BulkInsertItem[] = sourceChapters.map((c) => ({
    sourceId: c.id,
    doc: prepareChapter(
      c,
      {
        newId: chapterIdMap.get(c.id) as ObjectId,
        chapterTitle: chapterTitleById.get(c.id) ?? 'Untitled',
      },
      newCourseObjectId,
      slugSuffix,
      titles,
      createdByObjectId,
    ),
  }))

  // 5) Parent-first inserts, each filtered by surviving parents.
  const chaptersRes = await bulkInsert(req.payload, 'chapters', chapterItems)
  const survivingLessonItems = lessonItems.filter(
    (it) => !it.parentSourceId || !chaptersRes.failedSourceIds.has(it.parentSourceId),
  )
  const lessonsRes = await bulkInsert(req.payload, 'lessons', survivingLessonItems)
  const survivingExerciseItems = exerciseItems.filter(
    (it) => !it.parentSourceId || !lessonsRes.failedSourceIds.has(it.parentSourceId),
  )
  const exercisesRes = await bulkInsert(req.payload, 'exercises', survivingExerciseItems)
  const survivingSectionItems = sectionItems.filter(
    (it) => !it.parentSourceId || !exercisesRes.failedSourceIds.has(it.parentSourceId),
  )
  const sectionsRes = await bulkInsert(req.payload, 'sections', survivingSectionItems)

  const anyFailures =
    chaptersRes.failed + lessonsRes.failed + exercisesRes.failed + sectionsRes.failed
  if (anyFailures > 0) {
    req.payload.logger.warn(
      {
        chapters: chaptersRes.failures,
        lessons: lessonsRes.failures,
        exercises: exercisesRes.failures,
        sections: sectionsRes.failures,
      },
      `[cloneCourseTree] ${anyFailures} bulk-insert failure(s) — see writeErrors detail`,
    )
  }

  return {
    chaptersCloned: chaptersRes.inserted,
    chaptersFailed: chaptersRes.failed,
    lessonsCloned: lessonsRes.inserted,
    lessonsFailed: lessonsRes.failed,
    exercisesCloned: exercisesRes.inserted,
    exercisesFailed: exercisesRes.failed,
    sectionsCloned: sectionsRes.inserted,
    sectionsFailed: sectionsRes.failed,
  }
}

export interface CloneChapterTreeInput {
  sourceChapterId: string
  /** The already-created new chapter — caller creates it via `payload.create`. */
  newChapterObjectId: ObjectId
  newChapterTitle: string
  /**
   * Course the clone lives in. A chapter clone stays in the same course as its
   * source (we're duplicating, not moving), so this is the source chapter's
   * course id.
   */
  courseObjectId: ObjectId
  courseTitle: string
  createdByObjectId: ObjectId | null
  slugSuffix: string
}

/**
 * Clone every lesson, exercise, and section under `sourceChapterId` into the
 * already-created new chapter. All children are re-parented to the new chapter
 * id; the `course` FK stays unchanged (same course as the source).
 */
export async function cloneChapterTree(
  req: PayloadRequest,
  input: CloneChapterTreeInput,
): Promise<Omit<BulkCloneCounts, 'chaptersCloned' | 'chaptersFailed'>> {
  const {
    sourceChapterId,
    newChapterObjectId,
    newChapterTitle,
    courseObjectId,
    courseTitle,
    createdByObjectId,
    slugSuffix,
  } = input
  const titles: CourseTitles = { newCourseTitle: courseTitle }

  // 1) Parallel load every child under the source chapter.
  const [sourceLessonsFK, sourceExercisesFK, sourceSectionsFK] = await Promise.all([
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'lessons', {
      chapter: { equals: sourceChapterId },
    }),
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'exercises', {
      chapter: { equals: sourceChapterId },
    }),
    findAllPages<Record<string, unknown> & { id: string }>(req.payload, req, 'sections', {
      chapter: { equals: sourceChapterId },
    }),
  ])

  // 2a) Cross-reference healing — exercises referenced from lesson.blocks[]
  //     that live outside this chapter (e.g. a lesson under this chapter
  //     references an exercise FK-attached to a different lesson).
  const knownExerciseIds = new Set(sourceExercisesFK.map((e) => e.id))
  const missingExerciseIds: string[] = []
  const firstReferencingLesson = new Map<string, string>()
  for (const lesson of sourceLessonsFK) {
    for (const exId of collectExerciseRefIds(lesson.blocks)) {
      if (!firstReferencingLesson.has(exId)) firstReferencingLesson.set(exId, lesson.id)
      if (!knownExerciseIds.has(exId)) {
        knownExerciseIds.add(exId)
        missingExerciseIds.push(exId)
      }
    }
  }
  const extraExercises: Array<Record<string, unknown> & { id: string }> = []
  if (missingExerciseIds.length > 0) {
    const extra = await findAllPages<Record<string, unknown> & { id: string }>(
      req.payload,
      req,
      'exercises',
      { id: { in: missingExerciseIds } },
    )
    extraExercises.push(...extra)
  }
  const sourceExercises = [...sourceExercisesFK, ...extraExercises]

  // 2b) Sections referenced from exercise.blocks[] outside this chapter.
  const knownSectionIds = new Set(sourceSectionsFK.map((s) => s.id))
  const missingSectionIds: string[] = []
  const firstReferencingExercise = new Map<string, string>()
  for (const exercise of sourceExercises) {
    for (const secId of collectSectionRefIds(exercise.blocks)) {
      if (!firstReferencingExercise.has(secId)) firstReferencingExercise.set(secId, exercise.id)
      if (!knownSectionIds.has(secId)) {
        knownSectionIds.add(secId)
        missingSectionIds.push(secId)
      }
    }
  }
  const extraSections: Array<Record<string, unknown> & { id: string }> = []
  if (missingSectionIds.length > 0) {
    const extra = await findAllPages<Record<string, unknown> & { id: string }>(
      req.payload,
      req,
      'sections',
      { id: { in: missingSectionIds } },
    )
    extraSections.push(...extra)
  }
  const sourceSections = [...sourceSectionsFK, ...extraSections]

  // 3) Pre-generate new ObjectIds. Only one chapter in play (the new one),
  //    which was already created inline by the caller.
  const lessonIdMap = new Map<string, ObjectId>()
  const exerciseIdMap = new Map<string, ObjectId>()
  const sectionIdMap = new Map<string, ObjectId>()
  for (const l of sourceLessonsFK) lessonIdMap.set(l.id, new ObjectId())
  for (const e of sourceExercises) exerciseIdMap.set(e.id, new ObjectId())
  for (const s of sourceSections) sectionIdMap.set(s.id, new ObjectId())

  // Lookup tables.
  const lessonMetaById = new Map<string, { title: string }>()
  for (const l of sourceLessonsFK) {
    lessonMetaById.set(l.id, {
      title: typeof l.title === 'string' ? l.title : 'Untitled',
    })
  }
  const exerciseMetaById = new Map<string, { title: string; lessonId: string | null }>()
  for (const e of sourceExercises) {
    exerciseMetaById.set(e.id, {
      title: typeof e.title === 'string' ? e.title : '',
      lessonId: typeof e.lesson === 'string' ? e.lesson : null,
    })
  }

  // 4a) Sections — parented through exercise→lesson→(new chapter).
  const sectionItems: BulkInsertItem[] = []
  const preparedSectionIds = new Set<string>()
  for (const s of sourceSections) {
    const newId = sectionIdMap.get(s.id) as ObjectId
    let parentExId =
      typeof s.exercise === 'string' && exerciseMetaById.has(s.exercise) ? s.exercise : null
    if (!parentExId || !exerciseMetaById.get(parentExId)?.lessonId) {
      const referencingExId = firstReferencingExercise.get(s.id)
      if (referencingExId && exerciseMetaById.has(referencingExId)) {
        parentExId = referencingExId
      } else {
        continue
      }
    }
    const exMeta = exerciseMetaById.get(parentExId)
    if (!exMeta) continue
    let parentLessonId: string | null = null
    if (exMeta.lessonId && lessonMetaById.has(exMeta.lessonId)) {
      parentLessonId = exMeta.lessonId
    } else {
      const refLesson = firstReferencingLesson.get(parentExId)
      if (refLesson && lessonMetaById.has(refLesson)) parentLessonId = refLesson
    }
    if (!parentLessonId) continue
    const lessonMeta = lessonMetaById.get(parentLessonId)
    if (!lessonMeta) continue
    const newExerciseId = exerciseIdMap.get(parentExId)
    const newLessonId = lessonIdMap.get(parentLessonId)
    if (!newExerciseId || !newLessonId) continue

    sectionItems.push({
      sourceId: s.id,
      parentSourceId: parentExId,
      doc: prepareSection(
        s,
        newId,
        newExerciseId,
        newLessonId,
        newChapterObjectId,
        courseObjectId,
        titles,
        newChapterTitle,
        lessonMeta.title,
        exMeta.title,
        createdByObjectId,
      ),
    })
    preparedSectionIds.add(s.id)
  }

  // 4b) Exercises — parented under remapped lesson + new chapter.
  const exerciseItems: BulkInsertItem[] = []
  const preparedExerciseIds = new Set<string>()
  for (const e of sourceExercises) {
    const newId = exerciseIdMap.get(e.id) as ObjectId
    const meta = exerciseMetaById.get(e.id)
    if (!meta) continue
    let parentLessonId: string | null = null
    if (meta.lessonId && lessonMetaById.has(meta.lessonId)) {
      parentLessonId = meta.lessonId
    } else {
      const refLesson = firstReferencingLesson.get(e.id)
      if (refLesson && lessonMetaById.has(refLesson)) parentLessonId = refLesson
    }
    if (!parentLessonId) continue
    const lessonMeta = lessonMetaById.get(parentLessonId)
    if (!lessonMeta) continue
    const newLessonId = lessonIdMap.get(parentLessonId)
    if (!newLessonId) continue

    exerciseItems.push({
      sourceId: e.id,
      parentSourceId: parentLessonId,
      doc: prepareExercise(
        e,
        {
          newId,
          newLessonId,
          newChapterId: newChapterObjectId,
          chapterTitle: newChapterTitle,
          lessonTitle: lessonMeta.title,
          exerciseTitle: meta.title,
        },
        courseObjectId,
        sectionIdMap,
        preparedSectionIds,
        createdByObjectId,
      ),
    })
    preparedExerciseIds.add(e.id)
  }

  // 4c) Lessons — all parented under the new chapter.
  const lessonItems: BulkInsertItem[] = []
  for (const l of sourceLessonsFK) {
    const newId = lessonIdMap.get(l.id) as ObjectId
    const meta = lessonMetaById.get(l.id)
    if (!meta) continue
    lessonItems.push({
      sourceId: l.id,
      doc: prepareLesson(
        l,
        {
          newId,
          newChapterId: newChapterObjectId,
          chapterTitle: newChapterTitle,
          lessonTitle: meta.title,
        },
        courseObjectId,
        slugSuffix,
        titles,
        exerciseIdMap,
        preparedExerciseIds,
        createdByObjectId,
      ),
    })
  }

  // 5) Parent-first inserts. No chapters tier — the new chapter already exists.
  const lessonsRes = await bulkInsert(req.payload, 'lessons', lessonItems)
  const survivingExerciseItems = exerciseItems.filter(
    (it) => !it.parentSourceId || !lessonsRes.failedSourceIds.has(it.parentSourceId),
  )
  const exercisesRes = await bulkInsert(req.payload, 'exercises', survivingExerciseItems)
  const survivingSectionItems = sectionItems.filter(
    (it) => !it.parentSourceId || !exercisesRes.failedSourceIds.has(it.parentSourceId),
  )
  const sectionsRes = await bulkInsert(req.payload, 'sections', survivingSectionItems)

  const anyFailures = lessonsRes.failed + exercisesRes.failed + sectionsRes.failed
  if (anyFailures > 0) {
    req.payload.logger.warn(
      {
        lessons: lessonsRes.failures,
        exercises: exercisesRes.failures,
        sections: sectionsRes.failures,
      },
      `[cloneChapterTree] ${anyFailures} bulk-insert failure(s) — see writeErrors detail`,
    )
  }

  return {
    lessonsCloned: lessonsRes.inserted,
    lessonsFailed: lessonsRes.failed,
    exercisesCloned: exercisesRes.inserted,
    exercisesFailed: exercisesRes.failed,
    sectionsCloned: sectionsRes.inserted,
    sectionsFailed: sectionsRes.failed,
  }
}
