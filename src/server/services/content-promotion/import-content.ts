import type { Payload, PayloadRequest } from 'payload'
import JSZip from 'jszip'

import { MANIFEST_FILENAME, PROMOTED_COLLECTIONS, PromotedCollection } from './constants'
import { deepRewriteIds, generateNewId, IdRemap } from './id-remap'
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
    } else {
      // No blob in the bundle — only `external` media can legitimately be
      // created without a file. For any other type, `validateMediaUpload`
      // rejects the create with "MIME Type" validation, so skip defensively
      // and record it as failed rather than rolling back the whole import.
      // (The export side already drops such records — this guards against
      // older bundles or hand-edited manifests.)
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
    }
    report.created += 1
    if (wasRemapped) report.remapped += 1
  } catch (error) {
    report.failed += 1
    report.failures.push({
      id: finalId,
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
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
    throw error
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

  const remap = await detectCollisionsAndBuildRemap(payload, req, manifest)

  // Wrap the entire import in a single transaction. `beginTransaction` returns
  // a session ID on a replica set (Atlas) and `undefined` on a single-node
  // setup; in the latter case the rollback/commit calls are no-ops and we
  // degrade to best-effort atomicity. Any per-doc failure rolls the whole
  // import back so the target DB is never left half-populated.
  const transactionID = (await payload.db.beginTransaction?.()) ?? undefined
  if (transactionID) {
    ;(req as { transactionID?: string | number | undefined }).transactionID = transactionID
  }

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

    if (transactionID && payload.db.commitTransaction) {
      await payload.db.commitTransaction(transactionID)
    }
  } catch (error) {
    if (transactionID && payload.db.rollbackTransaction) {
      await payload.db.rollbackTransaction(transactionID)
    }
    throw error
  }

  for (const [key, newId] of remap.entries()) {
    report.remappedIds[key] = newId
  }
  report.durationMs = Date.now() - startedAt
  return report
}
