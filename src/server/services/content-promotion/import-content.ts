import type { Payload, PayloadRequest } from 'payload'
import JSZip from 'jszip'
import { ObjectId } from 'mongodb'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { getDefaultTenantId } from '@/server/repos/tenant/get-default-tenant'
import { MANIFEST_FILENAME, PROMOTED_COLLECTIONS, PromotedCollection } from './constants'
import { deepRewriteIds, generateNewId, IdRemap, nextAvailableSuffix, SlugRemap } from './id-remap'
import { markRequestAsContentPromotionImport } from './import-context'
import { BundleManifest, BundleManifestSchema, BundledMedia, ImportReport } from './types'

interface ImportFailure {
  id: string
  message: string
}

type CollectionReport = ImportReport['perCollection'][PromotedCollection]

function emptyReport(): ImportReport {
  const perCollection = {} as ImportReport['perCollection']
  for (const collection of PROMOTED_COLLECTIONS) {
    perCollection[collection] = {
      created: 0,
      remapped: 0,
      failed: 0,
      failures: [] as ImportFailure[],
    }
  }
  return {
    perCollection,
    remappedIds: {},
    remappedSlugs: {},
    blobsUploaded: 0,
    durationMs: 0,
  }
}

export async function parseBundle(
  buffer: Buffer,
): Promise<{ zip: JSZip; manifest: BundleManifest }> {
  const zip = await JSZip.loadAsync(buffer)
  const manifestEntry = zip.file(MANIFEST_FILENAME)
  if (!manifestEntry) {
    throw new Error(`Bundle is missing ${MANIFEST_FILENAME}`)
  }
  const manifestJson = await manifestEntry.async('string')
  const parsed = BundleManifestSchema.safeParse(JSON.parse(manifestJson))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ')
    throw new Error(`Invalid bundle manifest: ${issues}`)
  }
  return { zip, manifest: parsed.data }
}

/**
 * Mutates the manifest in-place to drop records that would trip the
 * `payload.create` step: missing/empty `id`, or duplicate `id` within the
 * same collection (Mongo `_id_` index can't accept that). Without this guard
 * a malformed bundle aborts the whole transaction with a `WiredTigerIdIndex`
 * collision and the user gets a meaningless retry-prompt error.
 *
 * Returns a summary of what was dropped so the caller can log it.
 */
function sanitizeManifestRecords(manifest: BundleManifest): {
  droppedMissingId: number
  droppedDuplicateId: number
} {
  let droppedMissingId = 0
  let droppedDuplicateId = 0

  for (const collection of PROMOTED_COLLECTIONS) {
    const docs = manifest.collections[collection] as unknown as Array<Record<string, unknown>>
    if (docs.length === 0) continue

    const seen = new Set<string>()
    const kept: Array<Record<string, unknown>> = []
    for (const doc of docs) {
      const id = doc.id
      if (typeof id !== 'string' || id.length === 0) {
        droppedMissingId += 1
        continue
      }
      if (seen.has(id)) {
        droppedDuplicateId += 1
        continue
      }
      seen.add(id)
      // Defensively strip Mongo-shadow `_id` — old bundles created before
      // export stripped it would otherwise let it through and conflict with
      // the import's `data.id` thread.
      if ('_id' in doc) delete doc._id
      kept.push(doc)
    }
    if (kept.length !== docs.length) {
      ;(manifest.collections as Record<string, unknown>)[collection] = kept
      manifest.counts[collection] = kept.length
    }
  }

  return { droppedMissingId, droppedDuplicateId }
}

/**
 * Collections whose `slug` field is declared `unique: true` at the collection
 * level (Payload materialises this as a Mongo unique index). During normal
 * writes the collection's `beforeChange` slug hook checks + suffixes on
 * collision; during content-promotion imports that hook is skipped for
 * performance (a full find per doc runs into minutes on Vercel), so a
 * collision now bubbles up as an E11000 duplicate-key error, formatted by
 * Payload as "The following field is invalid: slug" — see PR body for the
 * lesson-collision incident this fix addresses.
 *
 * Kept as an explicit allowlist rather than reflecting on the collection
 * config because the promoted set is small and this file already hardcodes
 * per-collection knowledge (see `EXERCISE_RELATIONSHIP_FIELDS` below).
 * Exercises use per-lesson uniqueness (hook-based, no DB index).
 */
const COLLECTIONS_WITH_UNIQUE_SLUG: readonly PromotedCollection[] = ['chapters', 'lessons']

/**
 * Courses enforce uniqueness on `(slug, locale)` via the
 * `enforceFieldLocaleUniqueness` beforeChange hook (see
 * validateLocaleUniqueness.ts). Unlike the lesson-slug hook, this one is
 * NOT skipped during content-promotion imports — the check is cheap (one
 * find per doc, and there are typically <10 courses per bundle) so removing
 * the guard entirely would be gratuitous. Instead we pre-scan the same
 * way we do for chapters/lessons but scope the "taken" set per-locale so
 * we only rename when the collision would actually trip the hook.
 */
const COLLECTIONS_WITH_PER_LOCALE_UNIQUE_SLUG: readonly PromotedCollection[] = ['courses']

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Reads all slugs on the target collection that match either an exact
 * bundled slug or `${bundledSlug}-${n}`. Both forms need to seed the
 * "committed" set — otherwise `nextAvailableSuffix` might hand out a slug
 * like `foo-1` that's already occupied by a doc the exact-match query
 * missed, and the doc lands right back at the E11000 wall this whole pass
 * exists to avoid. Regex done via the raw driver because Payload's `where`
 * doesn't expose `$regex` directly — same driver access pattern as
 * `bulkCreateExercises`. Projection to `{slug: 1}` keeps the response cheap
 * even on collections with thousands of docs.
 */
export async function fetchTakenSlugsForBases(
  payload: Payload,
  collection: PromotedCollection,
  bases: string[],
  additionalFilter: Record<string, unknown> = {},
): Promise<Set<string>> {
  if (bases.length === 0) return new Set()
  const pattern = new RegExp(`^(${bases.map(escapeRegex).join('|')})(-\\d+)?$`)
  const mongoCollection = (
    payload.db as unknown as {
      collections: Record<
        string,
        {
          collection: {
            find: (
              filter: Record<string, unknown>,
              opts: { projection: Record<string, unknown> },
            ) => { toArray: () => Promise<Array<{ slug?: string }>> }
          }
        }
      >
    }
  ).collections[collection]?.collection
  if (!mongoCollection) return new Set()
  const docs = await mongoCollection
    .find({ slug: pattern, ...additionalFilter }, { projection: { slug: 1 } })
    .toArray()
  const taken = new Set<string>()
  for (const d of docs) {
    if (typeof d.slug === 'string') taken.add(d.slug)
  }
  return taken
}

/**
 * Given the docs the bundle wants to insert and the slugs already claimed
 * on the target (base + any `${base}-${n}` variants), produce the remap of
 * source-doc-id → new-slug for anything that would collide. Pure so the
 * "which slug does bundled-doc-X get?" logic is unit-testable without a
 * live Payload.
 *
 * Walks bundled docs in manifest order and grows a running "committed" set.
 * First bundled claimant of a slug that isn't on target keeps it; every
 * subsequent claimant (target-side OR earlier bundled doc) gets suffixed
 * via `nextAvailableSuffix`. Deterministic and matches the source's own
 * manifest ordering so re-imports produce identical remaps.
 */
export function computeSlugRemap(
  collection: PromotedCollection,
  bundledDocs: Array<{ id: string; slug: string }>,
  takenOnTarget: Set<string>,
  slugRemap: SlugRemap,
): void {
  const committed = new Set<string>(takenOnTarget)
  for (const doc of bundledDocs) {
    if (!committed.has(doc.slug)) {
      committed.add(doc.slug)
      continue
    }
    const replacement = nextAvailableSuffix(doc.slug, committed)
    slugRemap.set(collection, doc.id, replacement)
  }
}

async function detectSlugCollisionsAndBuildRemap(
  payload: Payload,
  manifest: BundleManifest,
): Promise<SlugRemap> {
  const slugRemap = new SlugRemap()

  // Collection-level unique slug (chapters, lessons): one taken-set per
  // collection covers every locale.
  for (const collection of COLLECTIONS_WITH_UNIQUE_SLUG) {
    const docs = manifest.collections[collection] as unknown as Array<Record<string, unknown>>
    if (docs.length === 0) continue

    const bundledWithSlug: Array<{ id: string; slug: string }> = docs
      .filter((d) => typeof d.slug === 'string' && (d.slug as string).trim() !== '')
      .map((d) => ({ id: String(d.id), slug: d.slug as string }))
    if (bundledWithSlug.length === 0) continue

    const uniqueBundledSlugs = [...new Set(bundledWithSlug.map((d) => d.slug))]
    const takenOnTarget = await fetchTakenSlugsForBases(payload, collection, uniqueBundledSlugs)
    computeSlugRemap(collection, bundledWithSlug, takenOnTarget, slugRemap)
  }

  // Per-`(slug, locale)` unique (courses): group bundled docs by locale,
  // fetch target docs at THAT locale only, compute remap within the locale
  // scope. Otherwise a bundled `slug=course-8 locale=en` doc would get
  // needlessly renamed just because a dev doc has `slug=course-8 locale=he`
  // — the hook wouldn't have thrown for that pair.
  for (const collection of COLLECTIONS_WITH_PER_LOCALE_UNIQUE_SLUG) {
    const docs = manifest.collections[collection] as unknown as Array<Record<string, unknown>>
    if (docs.length === 0) continue

    const byLocale = new Map<string, Array<{ id: string; slug: string }>>()
    for (const d of docs) {
      const slug = d.slug
      if (typeof slug !== 'string' || slug.trim() === '') continue
      const locale = typeof d.locale === 'string' && d.locale ? d.locale : 'he'
      const bucket = byLocale.get(locale) ?? []
      bucket.push({ id: String(d.id), slug })
      byLocale.set(locale, bucket)
    }

    for (const [locale, bundledDocs] of byLocale) {
      const uniqueBundledSlugs = [...new Set(bundledDocs.map((d) => d.slug))]
      const takenOnTarget = await fetchTakenSlugsForBases(payload, collection, uniqueBundledSlugs, {
        locale,
      })
      computeSlugRemap(collection, bundledDocs, takenOnTarget, slugRemap)
    }
  }

  return slugRemap
}

async function detectCollisionsAndBuildRemap(
  payload: Payload,
  req: PayloadRequest,
  manifest: BundleManifest,
): Promise<IdRemap> {
  const remap = new IdRemap()

  for (const collection of PROMOTED_COLLECTIONS) {
    const docs = manifest.collections[collection]
    if (docs.length === 0) continue

    // Pull every doc with an `id` matching the bundle so we know which ones
    // collide. One bulk query per collection avoids N round-trips for large
    // bundles where most IDs won't collide.
    const ids = docs.map((d) => d.id)
    const existing = await payload.find({
      collection,
      where: { id: { in: ids } },
      depth: 0,
      limit: ids.length,
      pagination: false,
      overrideAccess: true,
      req,
    })

    const collidingIds = new Set((existing.docs as { id: string }[]).map((d) => d.id))
    for (const id of ids) {
      if (collidingIds.has(id)) {
        remap.set(collection, id, generateNewId())
      }
    }
  }

  return remap
}

function applyRemapToDoc(
  doc: Record<string, unknown>,
  collection: PromotedCollection,
  remap: IdRemap,
  slugRemap?: SlugRemap,
): { newDoc: Record<string, unknown>; finalId: string; wasRemapped: boolean } {
  const remappedId = remap.get(collection, String(doc.id))
  const rewritten = deepRewriteIds(doc, remap)
  const finalId = remappedId ?? String(doc.id)
  // Slug remap is keyed by SOURCE doc id (pre-remap) so we can look it up
  // regardless of whether the id itself is being rewritten this run. Slug
  // remaps aren't counted in `wasRemapped` — that field only tracks id
  // remaps for the per-collection tally. Slug remaps surface via the
  // top-level `remappedSlugs` map on the report.
  const remappedSlug = slugRemap?.get(collection, String(doc.id))
  const newDoc: Record<string, unknown> = { ...rewritten, id: finalId }
  if (remappedSlug !== undefined) newDoc.slug = remappedSlug
  return {
    newDoc,
    finalId,
    wasRemapped: Boolean(remappedId),
  }
}

async function uploadMediaWithFile(
  payload: Payload,
  req: PayloadRequest,
  bundled: BundledMedia,
  zip: JSZip,
  remap: IdRemap,
  report: CollectionReport,
): Promise<boolean> {
  const { newDoc, finalId, wasRemapped } = applyRemapToDoc(
    bundled as unknown as Record<string, unknown>,
    'media',
    remap,
  )
  // `blobEntry` is bundle-only metadata — strip it before sending to Payload.
  // `id` is set via `data.id` per `allowIDOnCreate: true` in the adapter
  // config; we pass it inside `data` and remove the top-level field.
  const { blobEntry, ...rest } = newDoc as { blobEntry?: string | null; [k: string]: unknown }

  try {
    if (blobEntry) {
      const entry = zip.file(blobEntry)
      if (!entry) {
        throw new Error(`Media binary missing from bundle: ${blobEntry}`)
      }
      const buffer = await entry.async('nodebuffer')
      const filename =
        typeof rest.filename === 'string' && rest.filename ? rest.filename : `${finalId}.bin`
      const mimetype =
        typeof rest.mimeType === 'string' && rest.mimeType
          ? rest.mimeType
          : 'application/octet-stream'

      await payload.create({
        collection: 'media',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bundle records are dynamic across collections
        data: rest as any,
        file: {
          data: buffer,
          mimetype,
          name: filename,
          size: buffer.length,
        },
        overrideAccess: true,
        req,
      })
      report.created += 1
      if (wasRemapped) report.remapped += 1
      return true
    } else {
      // No blob in the bundle — only `external` media can legitimately be
      // created without a file. For any other type, `validateMediaUpload`
      // rejects the create with "MIME Type" validation, so skip defensively
      // and record it as failed. (The export side already drops such
      // records — this guards against older bundles or hand-edited manifests.)
      if (rest.type !== 'external') {
        report.failed += 1
        report.failures.push({
          id: finalId,
          message: `Non-external media has no blob in bundle (type=${String(rest.type)})`,
        })
        return false
      }
      await payload.create({
        collection: 'media',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bundle records are dynamic across collections
        data: rest as any,
        overrideAccess: true,
        req,
      })
      report.created += 1
      if (wasRemapped) report.remapped += 1
      return false
    }
  } catch (error) {
    report.failed += 1
    report.failures.push({
      id: finalId,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    // Do NOT rethrow — see createDoc rationale.
    return false
  }
}

async function createDoc(
  payload: Payload,
  req: PayloadRequest,
  collection: PromotedCollection,
  doc: Record<string, unknown>,
  remap: IdRemap,
  slugRemap: SlugRemap,
  report: CollectionReport,
): Promise<void> {
  const { newDoc, finalId, wasRemapped } = applyRemapToDoc(doc, collection, remap, slugRemap)

  try {
    await payload.create({
      collection,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bundle records are dynamic across collections
      data: newDoc as any,
      overrideAccess: true,
      req,
    })
    report.created += 1
    if (wasRemapped) report.remapped += 1
  } catch (error) {
    report.failed += 1
    report.failures.push({
      id: finalId,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    // Do NOT rethrow — one bad record must not kill the whole import. The
    // caller records the failure in `report` and keeps going so any doc that
    // referenced this one will simply have a dangling ref on the target, and
    // the user can inspect `report.perCollection[collection].failures` after.
  }
}

/**
 * Relationship fields on `exercises` that Payload's Mongo adapter stores as
 * ObjectId (not string) when a doc is written through the local API. We're
 * bypassing that path with `insertMany`, so we have to convert any 24-hex
 * string values here manually — otherwise the resulting docs' relationship
 * queries won't match ones inserted through the normal admin flow.
 */
const EXERCISE_RELATIONSHIP_FIELDS = [
  'lesson',
  'chapter',
  'course',
  'tenant',
  'translatedFrom',
  'sourceDoc',
  'createdBy',
] as const

/**
 * Field-level `defaultValue`s and `beforeValidate` fallbacks on the
 * `exercises` collection that `payload.create` would silently backfill.
 * Bulk insert bypasses that path, so we apply the same defaults here — an
 * older exercise doc that never persisted these fields on the source would
 * otherwise land with `undefined` for a `required: true` field and then
 * refuse to save the next time an admin opens it.
 */
const EXERCISE_REQUIRED_FIELD_DEFAULTS: Record<string, unknown> = {
  origin: 'manual', // Exercises/index.ts:409-430 — required: true, beforeValidate falls back to 'manual'
  locale: 'he', // contentLocale.ts:18-29 — required: true, defaultValue 'he'
}

function toObjectIdIfHex(value: unknown): unknown {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) return value
  try {
    return new ObjectId(value)
  } catch {
    return value
  }
}

function coerceToDate(value: unknown): Date | undefined {
  if (value == null) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  return undefined
}

interface PreparedExercise {
  finalId: string
  wasRemapped: boolean
  doc: Record<string, unknown>
}

/**
 * Transforms a bundled exercise doc into an insert-ready shape for the raw
 * MongoDB driver. Pure function so it's covered by unit tests without a
 * live Payload. Returns null when the doc fails content validation — the
 * caller records the failure and moves on.
 *
 * Steps applied:
 *  1. Applies id-remap (safe-clone) — same as `applyRemapToDoc` in the per-
 *     doc path.
 *  2. Runs `ContentSchema.safeParse` on `content`, replacing the field
 *     validate that `payload.create` would have run.
 *  3. Renames Payload's virtual `id` → Mongo's `_id`, wrapped in an
 *     `ObjectId` so subsequent Payload queries (which cast their `id` values
 *     to `ObjectId`) actually match the stored doc. If the id isn't a valid
 *     24-hex string the doc is failed rather than silently stored with a
 *     wrong-typed `_id`.
 *  4. Applies defaults for `required: true` fields that Payload's
 *     `beforeValidate` hooks would have backfilled.
 *  5. Converts every known relationship field to `ObjectId` so downstream
 *     relationship queries resolve the same way as docs created via the
 *     normal admin flow.
 *
 * Each call to this function generates its own `now` so bulk-inserted docs
 * have distinguishable-enough timestamps for downstream sorting (they'll
 * differ by at least a nanosecond in practice — `new Date()` resolution is
 * milliseconds so they may tie, which is fine; the point is not sharing a
 * single instance across every doc in the batch).
 */
export function prepareExerciseForBulkInsert(
  doc: Record<string, unknown>,
  remap: IdRemap,
  defaultTenant: string | ObjectId | null,
): { ok: true; prepared: PreparedExercise } | { ok: false; finalId: string; message: string } {
  const { newDoc, finalId, wasRemapped } = applyRemapToDoc(doc, 'exercises', remap)

  const parsed = ContentSchema.safeParse((newDoc as { content?: unknown }).content)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ')
    return { ok: false, finalId, message: `Content validation failed: ${issues}` }
  }

  let mongoId: ObjectId
  try {
    mongoId = new ObjectId(finalId)
  } catch {
    return {
      ok: false,
      finalId,
      message: `_id "${finalId}" is not a valid 24-hex ObjectId — refusing to insert with a mismatched storage shape`,
    }
  }

  const now = new Date()
  const insertDoc: Record<string, unknown> = { ...newDoc }
  delete insertDoc.id
  insertDoc._id = mongoId
  insertDoc.content = parsed.data
  // Real bundles arrive from JSON.parse with ISO-string dates. `payload.create`
  // would cast them to BSON Date via the Mongoose schema; bulk insertMany
  // bypasses that path, so we coerce here — otherwise downstream date-range
  // queries won't match these docs the way they match Payload-created ones.
  insertDoc.createdAt = coerceToDate(insertDoc.createdAt) ?? now
  insertDoc.updatedAt = coerceToDate(insertDoc.updatedAt) ?? now

  // Defaults for required fields (tenant is handled below — needs the caller-
  // resolved default so we don't hit the DB per-doc).
  for (const [field, value] of Object.entries(EXERCISE_REQUIRED_FIELD_DEFAULTS)) {
    if (insertDoc[field] === undefined || insertDoc[field] === null) {
      insertDoc[field] = value
    }
  }
  if ((insertDoc.tenant === undefined || insertDoc.tenant === null) && defaultTenant !== null) {
    insertDoc.tenant = defaultTenant
  }

  for (const field of EXERCISE_RELATIONSHIP_FIELDS) {
    const value = insertDoc[field]
    if (Array.isArray(value)) {
      insertDoc[field] = value.map(toObjectIdIfHex)
    } else if (value !== undefined && value !== null) {
      insertDoc[field] = toObjectIdIfHex(value)
    }
  }

  return { ok: true, prepared: { finalId, wasRemapped, doc: insertDoc } }
}

interface MongoBulkCollection {
  insertMany: (
    docs: Array<Record<string, unknown>>,
    opts: { ordered: false },
  ) => Promise<{ insertedCount?: number }>
}

/**
 * Bulk-insert exercises with one Mongo round trip instead of N sequential
 * `payload.create` calls. This bypasses every Payload hook and every field-
 * level validator — for exercise-heavy imports it drops the write phase from
 * minutes to sub-second because there's no per-doc transaction overhead.
 *
 * Only used for bundles above `EXERCISE_HOOK_SKIP_THRESHOLD` (see the caller).
 * Below that, the per-doc `payload.create` path still runs so the
 * `addBlockToLesson` afterChange hook can heal any source-side drift where
 * an exercise's parent lesson.blocks doesn't already reference it.
 *
 * Preflight is handled entirely by `prepareExerciseForBulkInsert` above
 * (which is what the unit tests exercise). This function is the DB-touching
 * shell: batch, insertMany with `ordered: false`, per-doc failure reporting.
 */
async function bulkCreateExercises(
  payload: Payload,
  docs: Array<Record<string, unknown>>,
  remap: IdRemap,
  defaultTenant: string | ObjectId | null,
  report: CollectionReport,
): Promise<void> {
  if (docs.length === 0) return
  const prepared: Array<PreparedExercise> = []

  for (const doc of docs) {
    const result = prepareExerciseForBulkInsert(doc, remap, defaultTenant)
    if (result.ok) prepared.push(result.prepared)
    else {
      report.failed += 1
      report.failures.push({ id: result.finalId, message: result.message })
    }
  }

  if (prepared.length === 0) return

  const mongoCollection = (
    payload.db as unknown as {
      collections: Record<string, { collection: MongoBulkCollection }>
    }
  ).collections.exercises.collection

  try {
    await mongoCollection.insertMany(
      prepared.map((p) => p.doc),
      { ordered: false },
    )
    for (const p of prepared) {
      report.created += 1
      if (p.wasRemapped) report.remapped += 1
    }
  } catch (error) {
    // `ordered: false` means MongoDB kept going after per-doc errors and
    // reports them in `writeErrors`. We credit the docs that DID make it and
    // record the specific ones that didn't.
    const bulkErr = error as {
      writeErrors?: Array<{ index: number; errmsg?: string }>
    }
    const failedIndices = new Set<number>()
    if (Array.isArray(bulkErr.writeErrors)) {
      for (const we of bulkErr.writeErrors) {
        failedIndices.add(we.index)
        report.failed += 1
        report.failures.push({
          id: prepared[we.index].finalId,
          message: we.errmsg ?? 'Bulk insert failed',
        })
      }
      for (let i = 0; i < prepared.length; i += 1) {
        if (failedIndices.has(i)) continue
        report.created += 1
        if (prepared[i].wasRemapped) report.remapped += 1
      }
      return
    }
    // Not a BulkWriteError shape — record the whole batch as failed.
    for (const p of prepared) {
      report.failed += 1
      report.failures.push({
        id: p.finalId,
        message: error instanceof Error ? error.message : 'Unknown bulk insert error',
      })
    }
  }
}

export interface ImportContentInput {
  bundleBuffer: Buffer
}

export async function importContent(
  payload: Payload,
  req: PayloadRequest,
  input: ImportContentInput,
): Promise<ImportReport> {
  const startedAt = Date.now()
  const { zip, manifest } = await parseBundle(input.bundleBuffer)
  const report = emptyReport()

  const sanitizationStats = sanitizeManifestRecords(manifest)
  if (sanitizationStats.droppedMissingId > 0 || sanitizationStats.droppedDuplicateId > 0) {
    payload.logger.warn(
      sanitizationStats,
      '[content-promotion/import] Dropped malformed records from manifest before import',
    )
  }

  const remap = await detectCollisionsAndBuildRemap(payload, req, manifest)
  // Slug collisions are a separate pass: id-remap avoids `_id_` index
  // conflicts, slug-remap avoids the collection-level unique index on
  // chapters.slug / lessons.slug. Skipping the source's collision-suffix
  // hook for performance (see Lessons.ts:261) means those collisions used
  // to bubble up as "The following field is invalid: slug"; this remap
  // catches them pre-insert. One bulk find per affected collection.
  const slugRemap = await detectSlugCollisionsAndBuildRemap(payload, manifest)
  if (slugRemap.size() > 0) {
    payload.logger.info(
      { remappedSlugCount: slugRemap.size() },
      '[content-promotion/import] Auto-suffixed colliding slugs to avoid unique-index rejection',
    )
  }

  // Flag this request so the global id-on-create guard (payload.config.ts)
  // lets the import's `data.id` pass through. Every other code path strips
  // it; see import-context.ts for the rationale.
  markRequestAsContentPromotionImport(req)

  // Small bundles stay on `payload.create` for its beforeChange validation
  // and tenant/locale/origin defaulting. Large bundles switch to
  // `bulkCreateExercises` (raw insertMany) because `payload.create`'s
  // per-doc overhead pushed real-world 500-exercise imports past Vercel's
  // 5-min function ceiling. For those the bundle already carries every
  // required field verbatim (export walked parent refs — PR #105 — to
  // catch stale denorm), so `prepareExerciseForBulkInsert` fills the same
  // role as `beforeChange` on the per-doc path.
  //
  // NOTE: the Exercises afterChange block-sync hook is skipped for
  // content-promotion imports at every size (see PR #250 comment on
  // Exercises/index.ts:afterChange). Bundles carry `lesson.blocks` with
  // the exerciseRef playlist intact, so re-syncing is redundant — and
  // actively harmful when the playlist walker (PR #242) pulls in a
  // cross-course exercise whose `lesson` field points at a lesson not in
  // this bundle. So the small-bundle path is NOT preserving hook-based
  // healing; anyone tempted to remove the threshold entirely should know
  // that healing isn't why we split, and that bulkCreateExercises still
  // has to keep prepareExerciseForBulkInsert in sync with the Payload
  // schema.
  //
  // Threshold sits well below where the hook-skip path first showed
  // benefit, trading a small overhead cost on medium bundles for the
  // guarantee that any bundle we route through the raw driver is provably
  // large enough to justify bypassing Payload's validation stack.
  const EXERCISE_HOOK_SKIP_THRESHOLD = 50
  const exerciseCount = manifest.counts.exercises ?? 0
  const useBulkInsertForExercises = exerciseCount > EXERCISE_HOOK_SKIP_THRESHOLD

  // Resolve the default tenant once up front — bulk insert bypasses the
  // tenant field's `beforeValidate` backfill, so we pass the id in per-doc.
  // Doing this here (rather than inside `prepareExerciseForBulkInsert`)
  // keeps the pure function testable without a live Payload and avoids N
  // redundant reads/cache-primes in the hot loop. Wrapped so a tenants
  // collection misconfiguration on the target doesn't kill the whole import
  // — the per-doc fallback is a missing `tenant`, which the doc's own
  // required-field check will then surface as a per-doc failure.
  let defaultTenant: string | ObjectId | null = null
  try {
    defaultTenant = await getDefaultTenantId(payload)
  } catch (err) {
    payload.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[content-promotion/import] Could not resolve default tenant; bulk-inserted exercises missing an explicit tenant will fail per-doc',
    )
  }

  // No cross-doc transaction: MongoDB's transactionLifetimeLimitSeconds
  // defaults to 60, so real-world bundles (dozens of media re-uploads plus
  // hundreds of doc creates) reliably tripped that limit mid-flight —
  // MongoDB aborted the session and every subsequent create bubbled up as
  // "Transaction ... has been aborted." Losing atomicity across the whole
  // import is the trade-off: on failure the target keeps whatever docs did
  // land, and the caller inspects `report.perCollection[c].failures` for
  // per-doc errors. Safe-clone semantics still guarantee no existing target
  // doc is overwritten, and a retry of a partial import creates remapped
  // duplicates of the completed subset (visible to the user via the report)
  // rather than resurrecting the failure.
  for (const bundled of manifest.collections.media) {
    const blobUploaded = await uploadMediaWithFile(
      payload,
      req,
      bundled,
      zip,
      remap,
      report.perCollection.media,
    )
    if (blobUploaded) report.blobsUploaded += 1
  }
  for (const collection of PROMOTED_COLLECTIONS) {
    if (collection === 'media') continue
    if (collection === 'exercises' && useBulkInsertForExercises) {
      payload.logger.info(
        { exerciseCount, threshold: EXERCISE_HOOK_SKIP_THRESHOLD },
        '[content-promotion/import] Using bulk insertMany for exercises (large bundle); block-sync hook skipped, bundle carries lesson.blocks',
      )
      await bulkCreateExercises(
        payload,
        manifest.collections.exercises as unknown as Array<Record<string, unknown>>,
        remap,
        defaultTenant,
        report.perCollection.exercises,
      )
      continue
    }
    for (const doc of manifest.collections[collection]) {
      await createDoc(
        payload,
        req,
        collection,
        doc as unknown as Record<string, unknown>,
        remap,
        slugRemap,
        report.perCollection[collection],
      )
    }
  }

  for (const [key, newId] of remap.entries()) {
    report.remappedIds[key] = newId
  }
  for (const [key, newSlug] of slugRemap.entries()) {
    report.remappedSlugs[key] = newSlug
  }
  report.durationMs = Date.now() - startedAt
  return report
}
