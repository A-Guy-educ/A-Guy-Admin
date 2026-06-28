import { z } from 'zod'

import { BUNDLE_MANIFEST_VERSION, PROMOTED_COLLECTIONS, PromotedCollection } from './constants'

/**
 * A single media record reduced to the fields the import side needs to
 * recreate the document. The blob bytes (if any) live in the zip under
 * `blobs/<id>`.
 */
export const BundledMediaSchema = z
  .object({
    id: z.string(),
    blobEntry: z.string().nullable(),
  })
  .passthrough()

export const BundledDocSchema = z
  .object({
    id: z.string(),
  })
  .passthrough()

export const BundleManifestSchema = z.object({
  version: z.literal(BUNDLE_MANIFEST_VERSION),
  exportedAt: z.string(),
  source: z.object({
    serverUrl: z.string().optional(),
    databaseName: z.string().optional(),
  }),
  counts: z.record(z.enum(PROMOTED_COLLECTIONS), z.number()),
  collections: z.object({
    media: z.array(BundledMediaSchema),
    courses: z.array(BundledDocSchema),
    chapters: z.array(BundledDocSchema),
    lessons: z.array(BundledDocSchema),
    exercises: z.array(BundledDocSchema),
  }),
})

export type BundleManifest = z.infer<typeof BundleManifestSchema>
export type BundledMedia = z.infer<typeof BundledMediaSchema>
export type BundledDoc = z.infer<typeof BundledDocSchema>

export interface ImportReport {
  perCollection: Record<
    PromotedCollection,
    {
      created: number
      remapped: number
      failed: number
      failures: Array<{ id: string; message: string }>
    }
  >
  remappedIds: Record<string, string>
  blobsUploaded: number
  durationMs: number
}

export interface ExportReport {
  counts: Record<PromotedCollection, number>
  blobs: number
  bytes: number
  durationMs: number
}
