/**
 * POST /api/cron/media-expiry
 * Cleanup endpoint for expired ephemeral media
 *
 * @fileType endpoint
 * @domain media
 * @pattern cron-endpoint, authenticated-endpoint
 * @ai-summary Deletes expired ephemeral media files and database records
 *
 * Access: Requires CRON_SECRET bearer token
 *
 * Features:
 * - Finds all ephemeral media where expiresAt < now
 * - Deletes files from filesystem (best effort)
 * - Deletes database records (authoritative)
 * - Returns deletion stats for monitoring
 */
import fs from 'fs/promises'
import type { Endpoint, Payload } from 'payload'
import type { Logger } from 'pino'

import { resolveMediaFilePath } from '@/infra/config/storage'

import { withCronMiddleware, type CronResult } from './cron-middleware'

interface MediaDocument {
  id: string
  filename?: string
}

interface CleanupStats {
  deletedCount: number
  failedCount: number
  fileDeleteFailures: string[]
  dbDeleteFailures: string[]
}

/**
 * Find expired ephemeral media documents
 */
async function findExpiredMedia(
  payload: Payload,
): Promise<{ docs: MediaDocument[]; totalDocs: number }> {
  const now = new Date().toISOString()

  const result = await payload.find({
    collection: 'media',
    where: {
      and: [{ retentionPolicy: { equals: 'ephemeral' } }, { expiresAt: { less_than_equal: now } }],
    },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })

  return {
    docs: result.docs as MediaDocument[],
    totalDocs: result.totalDocs,
  }
}

/**
 * Delete file from filesystem (best effort)
 */
async function deleteMediaFile(
  filename: string,
  mediaId: string,
  reqLogger: Logger,
): Promise<string | null> {
  try {
    const filePath = resolveMediaFilePath(filename)
    await fs.unlink(filePath)
    reqLogger.debug({ filename }, 'Deleted file from filesystem')
    return null
  } catch (error) {
    const errorMsg = (error as Error).message
    reqLogger.debug({ filename, err: error }, 'File deletion skipped/failed')
    return `${mediaId}: ${errorMsg}`
  }
}

/**
 * Delete media record from database
 */
async function deleteMediaRecord(payload: Payload, mediaId: string): Promise<void> {
  await payload.delete({
    collection: 'media',
    id: mediaId,
    overrideAccess: true,
  })
}

/**
 * Process a single media document for deletion
 */
async function processMediaDeletion(
  payload: Payload,
  media: MediaDocument,
  stats: CleanupStats,
  reqLogger: Logger,
): Promise<void> {
  try {
    // Best-effort file deletion first
    if (media.filename) {
      const fileError = await deleteMediaFile(media.filename, media.id, reqLogger)
      if (fileError) {
        stats.fileDeleteFailures.push(fileError)
      }
    }

    // Authoritative DB deletion
    await deleteMediaRecord(payload, media.id)
    stats.deletedCount++
    reqLogger.info({ mediaId: media.id, filename: media.filename }, 'Deleted expired media')
  } catch (error) {
    stats.failedCount++
    const errorMsg = error instanceof Error ? error.message : String(error)
    stats.dbDeleteFailures.push(`${media.id}: ${errorMsg}`)
    reqLogger.error({ mediaId: media.id, error: errorMsg }, 'Failed to delete media')
  }
}

/**
 * Main cleanup handler
 */
async function cleanupExpiredMedia(payload: Payload, reqLogger: Logger): Promise<CronResult> {
  const stats: CleanupStats = {
    deletedCount: 0,
    failedCount: 0,
    fileDeleteFailures: [],
    dbDeleteFailures: [],
  }

  const expiredMedia = await findExpiredMedia(payload)
  reqLogger.info({ count: expiredMedia.docs.length }, 'Found expired media to delete')

  for (const media of expiredMedia.docs) {
    await processMediaDeletion(payload, media, stats, reqLogger)
  }

  return {
    success: true,
    data: {
      deletedCount: stats.deletedCount,
      failedCount: stats.failedCount,
      hasMore: expiredMedia.totalDocs > stats.deletedCount + stats.failedCount,
      fileDeleteFailures:
        stats.fileDeleteFailures.length > 0 ? stats.fileDeleteFailures : undefined,
      dbDeleteFailures: stats.dbDeleteFailures.length > 0 ? stats.dbDeleteFailures : undefined,
    },
  }
}

export const mediaExpiryCleanupEndpoint: Endpoint = {
  path: '/cron/media-expiry',
  method: 'post',
  handler: withCronMiddleware(async ({ reqLogger, payload }) => {
    return cleanupExpiredMedia(payload, reqLogger)
  }),
}
