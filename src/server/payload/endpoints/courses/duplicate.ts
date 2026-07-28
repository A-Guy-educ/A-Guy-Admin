/**
 * POST /api/courses/:id/duplicate-course
 *
 * @fileType api-route
 * @domain courses
 * @pattern duplication-bulk-insert
 * @ai-summary Deep-clones a course + all chapters + lessons + exercises + sections via raw insertMany.
 *
 * Body: {} (no options — course duplication is always an exact copy)
 *
 * PERFORMANCE — raw `insertMany` instead of `payload.create`.
 *
 * The prior version marked the request as a content-promotion import to skip
 * heavy per-doc hooks, but still routed every write through `payload.create`.
 * On a real ~60-lesson course that still meant thousands of sequential Mongo
 * round-trips through a maxPoolSize=3 pool — ~1 hour wall time.
 *
 * This version mirrors `bulkCreateExercises` in the content-promotion import
 * flow (see src/server/services/content-promotion/import-content.ts:638): grab
 * the raw Mongo collection off `payload.db.collections[X].collection` and call
 * `insertMany(docs, { ordered: false })` — one round trip per collection,
 * hundreds or thousands of docs per call. Sub-second write phase.
 *
 * That bypasses every Payload hook AND every field-level validator, so we
 * have to reproduce what those would have done:
 *   - id-remap: pre-generate fresh ObjectIds for every child doc and build
 *     source→new maps for chapters, lessons, exercises, sections
 *   - relationship fields (chapter/course/lesson/exercise/tenant/etc.) are
 *     converted from 24-hex string → ObjectId so subsequent Payload queries
 *     (which cast their `id` values to ObjectId) actually match the stored
 *     doc — see EXERCISE_RELATIONSHIP_FIELDS handling in import-content.ts
 *   - createdAt/updatedAt coerced to real Date objects
 *   - `id` (Payload virtual) removed; `_id` set to the pre-generated ObjectId
 *   - slugs pre-computed unique for collections with global unique indexes
 *     (chapters, lessons) — same `{baseSlug}-copy-{suffix}` pattern
 *   - adminTitle breadcrumbs assembled in-memory
 *   - lesson.blocks[].exercise and exercise.blocks[].section rewired via the
 *     id maps so the cloned course has its own playlist DAG
 *   - block ids inside those playlists regenerated so admins editing one copy
 *     don't overwrite the other via id collision
 *   - createdBy set to the duplicating admin (not source's author)
 *   - translatedFrom cleared — the duplicate is a fresh doc, not a translation
 *
 * The course itself still goes through `payload.create` because it's a single
 * doc and the hook validation is worth keeping for the top-level record.
 * Only the children go through the raw path.
 *
 * Access: admin only.
 */
import { randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'

import type { Payload, PayloadRequest, Where } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'

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

/** Strip Payload-managed virtual fields from a doc. */
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

/** 6-char hex suffix used to guarantee slug uniqueness on cloned rows. */
function shortSuffix(): string {
  return randomBytes(3).toString('hex')
}

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
 * Mongoose adapter casts these to ObjectId during `payload.create`; raw
 * `insertMany` doesn't, so a doc left with a 24-hex string here won't match
 * later `find({ where: { <field>: <someId> } })` queries whose values get
 * cast to ObjectId. Must include every relationship / upload field across
 * chapters, lessons, exercises, sections. Adding a field to the schemas
 * without adding it here silently breaks read-path population.
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
  // Lesson-only fields
  'prerequisites',
  'nextLessons',
  'contentFiles',
  // Exercise-only fields
  'sourceDoc',
] as const

/**
 * Coerce nested relationship fields that don't live at the doc root — e.g.
 * `meta.image` is a group-nested media upload on lessons. Called from
 * `coerceRelationshipsAndDates` after the flat-field pass.
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
 * Read every page of docs matching the filter (Payload's default limit
 * silently truncates on courses larger than a page).
 */
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

interface BulkInsertResult {
  inserted: number
  failed: number
  failures: Array<{ sourceId: string; message: string }>
  /**
   * Source doc ids that failed to insert. Used by the caller to filter
   * downstream collections whose parent didn't land — otherwise the child
   * would sit with a foreign-key pointing at nothing.
   */
  failedSourceIds: Set<string>
}

interface BulkInsertItem {
  sourceId: string
  /**
   * Source id of the parent doc in the hierarchy (e.g. lesson's chapter,
   * exercise's parent lesson, section's parent exercise). The sequential
   * insert pipeline uses this to skip children whose parent didn't land.
   * Optional because chapters have no parent inside this clone.
   */
  parentSourceId?: string
  doc: Record<string, unknown>
}

/**
 * Split `items` into batches that respect both `INSERT_MANY_MAX_DOCS` (count)
 * and `INSERT_MANY_MAX_BYTES` (approx BSON size, measured against the
 * JSON serialization since Mongo's driver serializes to BSON with roughly the
 * same magnitude for our shapes). A single doc that on its own exceeds the
 * byte budget still gets its own batch — that way an oversized section blows
 * up alone instead of taking 499 healthy siblings with it.
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
 * collections whose ancestor failed to insert — critical because Mongo doesn't
 * enforce FKs and we'd otherwise land orphaned children.
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
        // Not a BulkWriteError — treat the whole batch as failed.
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
 * Build an insert-ready chapter doc. Chapters need a unique slug (global
 * unique index) and an adminTitle in the "title — course" format that
 * computeAdminTitle would produce.
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
 * actually prepared (`preparedExerciseIds`) are dropped so the new lesson
 * doesn't hold dangling refs. The extra "prepared" guard on top of the id
 * map matters for cross-course exercises: they get an id assigned during the
 * step-3a union walk, but if their FK lesson lives outside this course AND
 * no referencing lesson could be found for re-parenting, they never make it
 * to the exercise-prep loop.
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

/**
 * Build an insert-ready exercise doc. `blocks` is rewritten with the new
 * section ids from `sectionIdMap`. Exercise slugs are per-lesson-unique — no
 * cross-course collision risk since the new exercise sits under a fresh
 * lesson id.
 */
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

  // Same drop-unmapped guard as prepareLesson (see rationale above): even
  // if `sectionIdMap` has an entry for the referenced section, we only keep
  // the block if that section was actually prepared. Cross-course sections
  // whose parent exercise isn't in the clone get an id but no insert.
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
 * computeSectionAdminTitle would have produced.
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
  const doc: Record<string, unknown> = {
    ...rest,
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
  const sourceCourseId = match?.[1]
  if (!sourceCourseId) {
    return Response.json({ error: 'Course id missing from path' }, { status: 400 })
  }

  // Mark the request so any hook that DOES run (course create only, in this
  // path) short-circuits its heavy work.
  markRequestAsContentPromotionImport(req)

  // 1) Load + verify the source course exists.
  const existsRes = await req.payload.find({
    collection: 'courses',
    where: { id: { equals: sourceCourseId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const sourceCourse = existsRes.docs[0] as unknown as Record<string, unknown> | undefined
  if (!sourceCourse) {
    return Response.json({ error: `Course "${sourceCourseId}" not found` }, { status: 404 })
  }

  const sourceData = stripManagedFields(sourceCourse)
  const {
    slug: sourceSlug,
    translatedFrom: _tf,
    createdBy: _cb,
    ...restCourseSource
  } = sourceData as Record<string, unknown>
  void _tf
  void _cb

  const baseTitle = typeof sourceData.title === 'string' ? sourceData.title : 'Untitled'
  const newCourseTitle = `${baseTitle} - Copy`
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(baseTitle)
  const suffix = shortSuffix()
  const titles: CourseTitles = { newCourseTitle }

  // 2) Create the new course via payload.create — one doc, hook validation
  //    is worth keeping for the top-level record. Everything below goes
  //    through raw insertMany.
  const newCourseData = {
    ...restCourseSource,
    title: newCourseTitle,
    slug: `${baseSlug}-copy-${suffix}`,
    status: 'draft',
  }
  const newCourse = await req.payload.create({
    collection: 'courses',
    data: newCourseData as never,
    overrideAccess: true,
    req,
  })
  const newCourseId = newCourse.id
  const newCourseObjectId = toObjectIdIfHex(newCourseId) as ObjectId

  const createdByObjectId = toObjectIdIfHex(user.id) as ObjectId | null

  // 3) Parallel load every child under the source course. `maxPoolSize: 3`
  //    caps this at 3 concurrent ops, but even bounded that's 4x-ish faster
  //    than serial and the parallel wait doesn't cost anything the serial
  //    path wouldn't have paid anyway.
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

  // 3a) Cross-course reference healing: lesson.blocks[].exercise sometimes
  //     points at exercises whose own `course`/`lesson` field lives outside
  //     this course (see getSourceExercisesForLesson for the incident that
  //     drove that fallback). Union the FK query results with anything the
  //     playlist references so the duplicated course doesn't lose exercises.
  //     Also track which source lesson first referenced each such exercise —
  //     when we prep the exercise, that referencing lesson's newly-generated
  //     lesson id becomes the exercise's parent (mirrors the old serial-path
  //     behavior of re-parenting cross-course exercises under the current
  //     lesson via `payload.create({ ..., lesson: newLesson.id })`).
  const knownExerciseIds = new Set(sourceExercisesFK.map((e) => e.id))
  const missingExerciseIds: string[] = []
  const firstReferencingLesson = new Map<string, string>()
  for (const lesson of sourceLessonsFK) {
    for (const exId of collectExerciseRefIds(lesson.blocks)) {
      if (!firstReferencingLesson.has(exId)) {
        firstReferencingLesson.set(exId, lesson.id)
      }
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

  // 3b) Same union pattern for sections referenced from exercise.blocks
  //     that live outside this course. `firstReferencingExercise` mirrors
  //     `firstReferencingLesson` above.
  const knownSectionIds = new Set(sourceSectionsFK.map((s) => s.id))
  const missingSectionIds: string[] = []
  const firstReferencingExercise = new Map<string, string>()
  for (const exercise of sourceExercises) {
    for (const secId of collectSectionRefIds(exercise.blocks)) {
      if (!firstReferencingExercise.has(secId)) {
        firstReferencingExercise.set(secId, exercise.id)
      }
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

  // 4) Pre-generate new ObjectIds for every child + build source→new id maps.
  const chapterIdMap = new Map<string, ObjectId>()
  const lessonIdMap = new Map<string, ObjectId>()
  const exerciseIdMap = new Map<string, ObjectId>()
  const sectionIdMap = new Map<string, ObjectId>()
  for (const c of sourceChapters) chapterIdMap.set(c.id, new ObjectId())
  for (const l of sourceLessonsFK) lessonIdMap.set(l.id, new ObjectId())
  for (const e of sourceExercises) exerciseIdMap.set(e.id, new ObjectId())
  for (const s of sourceSections) sectionIdMap.set(s.id, new ObjectId())

  // Lookup tables for titles / hierarchy resolution during prep.
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
    const exLessonId = typeof e.lesson === 'string' ? e.lesson : null
    const exChapterId = typeof e.chapter === 'string' ? e.chapter : null
    exerciseMetaById.set(e.id, {
      title: typeof e.title === 'string' ? e.title : '',
      lessonId: exLessonId,
      chapterId: exChapterId,
    })
  }

  // 5) Prepare each collection's docs. Order matters: sections first (so we
  //    know which section ids will be prepared for exercise-block filtering),
  //    then exercises (so we know which exercise ids for lesson-block filtering),
  //    then lessons, then chapters. Each item carries `parentSourceId` so the
  //    insert stage can drop children whose ancestor failed to land.

  // 5a) Sections — parented under the exercise their FK points to, OR under
  //     the exercise that first referenced them (for cross-exercise sections
  //     pulled in via step 3b). Sections whose parent exercise chain doesn't
  //     resolve to a lesson we cloned are skipped entirely.
  const sectionItems: BulkInsertItem[] = []
  const preparedSectionIds = new Set<string>()
  for (const s of sourceSections) {
    const newId = sectionIdMap.get(s.id) as ObjectId
    let parentExId =
      typeof s.exercise === 'string' && exerciseMetaById.has(s.exercise) ? s.exercise : null
    if (!parentExId || !exerciseMetaById.get(parentExId)?.lessonId) {
      // FK exercise isn't in this course (or has no resolvable lesson).
      // Fall back to whichever exercise first referenced this section.
      const referencingExId = firstReferencingExercise.get(s.id)
      if (referencingExId && exerciseMetaById.has(referencingExId)) {
        parentExId = referencingExId
      } else {
        continue
      }
    }
    const exMeta = exerciseMetaById.get(parentExId)
    if (!exMeta) continue
    // Resolve the parent lesson: exercise's own FK lesson if that's in the
    // course, else the exercise's own first-referencing lesson (already
    // computed in step 3a).
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

  // 5b) Exercises — parented under the exercise's FK lesson if that lesson
  //     is in this course, else under the first lesson that referenced this
  //     exercise via its blocks (cross-course pull-in from step 3a).
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

  // 5c) Lessons — parented under their chapter. Lesson.blocks refs are
  //     filtered by `preparedExerciseIds` inside prepareLesson.
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
        suffix,
        titles,
        exerciseIdMap,
        preparedExerciseIds,
        createdByObjectId,
      ),
    })
  }

  // 5d) Chapters — top of the child tree, no parent filter.
  const chapterItems: BulkInsertItem[] = sourceChapters.map((c) => ({
    sourceId: c.id,
    doc: prepareChapter(
      c,
      {
        newId: chapterIdMap.get(c.id) as ObjectId,
        chapterTitle: chapterTitleById.get(c.id) ?? 'Untitled',
      },
      newCourseObjectId,
      suffix,
      titles,
      createdByObjectId,
    ),
  }))

  // 6) Sequential bulk-insert with per-stage filtering. Parent-first order:
  //    a failed parent means we drop its would-be children instead of
  //    landing them as orphans with a foreign-key pointing at nothing.
  //    Insert is fast enough (one round trip per collection per batch) that
  //    the loss of parallelism is negligible.
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
      `[duplicateCourseEndpoint] ${anyFailures} bulk-insert failure(s) — see writeErrors detail`,
    )
  }

  return Response.json({
    outputCourseId: newCourseId,
    counts: {
      chaptersCloned: chaptersRes.inserted,
      chaptersFailed: chaptersRes.failed,
      lessonsCloned: lessonsRes.inserted,
      lessonsFailed: lessonsRes.failed,
      exercisesCloned: exercisesRes.inserted,
      exercisesFailed: exercisesRes.failed,
      sectionsCloned: sectionsRes.inserted,
      sectionsFailed: sectionsRes.failed,
    },
  })
}
