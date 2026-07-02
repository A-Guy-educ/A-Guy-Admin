import type { Payload, PayloadRequest } from 'payload'
import JSZip from 'jszip'

import { MANIFEST_FILENAME, PROMOTED_COLLECTIONS, PromotedCollection } from './constants'
import { deepRewriteIds, generateNewId, IdRemap } from './id-remap'
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
): { newDoc: Record<string, unknown>; finalId: string; wasRemapped: boolean } {
  const remappedId = remap.get(collection, String(doc.id))
  const rewritten = deepRewriteIds(doc, remap)
  const finalId = remappedId ?? String(doc.id)
  return {
    newDoc: { ...rewritten, id: finalId },
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
): Promise<void> {
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
        return
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
    }
  } catch (error) {
    report.failed += 1
    report.failures.push({
      id: finalId,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    // Do NOT rethrow — see createDoc rationale.
  }
}

async function createDoc(
  payload: Payload,
  req: PayloadRequest,
  collection: PromotedCollection,
  doc: Record<string, unknown>,
  remap: IdRemap,
  report: CollectionReport,
): Promise<void> {
  const { newDoc, finalId, wasRemapped } = applyRemapToDoc(doc, collection, remap)

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

  // Flag this request so the global id-on-create guard (payload.config.ts)
  // lets the import's `data.id` pass through. Every other code path strips
  // it; see import-context.ts for the rationale.
  markRequestAsContentPromotionImport(req)

  // Skip the Exercises `afterChange` block-sync hook when the bundle is big
  // enough that its per-exercise `findByID` + `update` of the parent lesson
  // (~2s each on Atlas via Vercel) would push the total wall time past the
  // 5-minute function ceiling. Small bundles keep the hook on — it's cheap,
  // it dedupes so it can't cause duplicate `exerciseRef` blocks, and it
  // "heals" any source-side inconsistency where an exercise wasn't in its
  // parent lesson's blocks. Threshold picked so at ~2s/exercise the hook
  // portion stays under ~100s, leaving plenty of headroom for the rest of
  // the import to fit under Vercel's 5-min cap.
  const EXERCISE_HOOK_SKIP_THRESHOLD = 50
  const exerciseCount = manifest.counts.exercises ?? 0
  if (exerciseCount > EXERCISE_HOOK_SKIP_THRESHOLD) {
    ;(req.context as Record<string, unknown>)._skipBlockSync = true
    payload.logger.info(
      { exerciseCount, threshold: EXERCISE_HOOK_SKIP_THRESHOLD },
      '[content-promotion/import] Skipping exercise block-sync hook (large bundle); bundle already carries lesson.blocks with the correct refs',
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
  try {
    for (const bundled of manifest.collections.media) {
      await uploadMediaWithFile(payload, req, bundled, zip, remap, report.perCollection.media)
      if (bundled.blobEntry) report.blobsUploaded += 1
    }
    for (const collection of PROMOTED_COLLECTIONS) {
      if (collection === 'media') continue
      for (const doc of manifest.collections[collection]) {
        await createDoc(
          payload,
          req,
          collection,
          doc as unknown as Record<string, unknown>,
          remap,
          report.perCollection[collection],
        )
      }
    }
  } catch (error) {
    // Per-doc errors are captured on `report` without rethrowing; anything
    // that lands here is a catastrophic failure (zip corruption after parse,
    // Payload init failure mid-run, etc.). Surface it — the report so far
    // is still useful context but we can't finalise a partial-success reply.
    throw error
  }

  for (const [key, newId] of remap.entries()) {
    report.remappedIds[key] = newId
  }
  report.durationMs = Date.now() - startedAt
  return report
}
