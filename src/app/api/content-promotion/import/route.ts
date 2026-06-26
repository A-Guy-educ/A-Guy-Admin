/**
 * Content Promotion — Import
 *
 * POST /api/content-promotion/import
 * Accepts a multipart upload containing the zip bundle produced by the
 * matching export endpoint. Performs a safe-clone import: existing IDs on the
 * target are preserved when free, and freshly generated when they collide.
 * The whole import runs inside a Payload transaction — any per-doc failure
 * rolls everything back.
 */
import configPromise from '@payload-config'
import type { PayloadRequest } from 'payload'
import { getPayload } from 'payload'
import { NextRequest } from 'next/server'
import type { User } from 'payload'

import { requireAdmin } from '@/server/api/auth'
import { ApiErrors, apiError, apiSuccess } from '@/server/api/responses'
import { importContent } from '@/server/services/content-promotion/import-content'

const MAX_BUNDLE_BYTES = 500 * 1024 * 1024

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const payload = await getPayload({ config: configPromise })
    const { user } = await payload.auth({ headers: request.headers })

    try {
      requireAdmin(user as User | null)
    } catch {
      return ApiErrors.unauthorized('Admin access required')
    }

    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return apiError('BAD_REQUEST', 'Expected multipart/form-data', 400)
    }

    const formData = await request.formData()
    const file = formData.get('bundle')
    if (!(file instanceof File)) {
      return apiError('BAD_REQUEST', 'Missing `bundle` file field', 400)
    }
    if (file.size > MAX_BUNDLE_BYTES) {
      return ApiErrors.payloadTooLarge(
        `Bundle exceeds ${MAX_BUNDLE_BYTES} bytes (${file.size})`,
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const bundleBuffer = Buffer.from(arrayBuffer)

    const payloadReq = {
      payload,
      user: user as User,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const report = await importContent(payload, payloadReq, { bundleBuffer })

    payload.logger.info(
      {
        counts: Object.fromEntries(
          Object.entries(report.perCollection).map(([k, v]) => [k, v.created]),
        ),
        remapped: Object.keys(report.remappedIds).length,
        blobs: report.blobsUploaded,
        ms: report.durationMs,
      },
      '[content-promotion/import] Import complete',
    )

    return apiSuccess(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return apiError('INTERNAL_ERROR', `Import failed: ${message}`, 500)
  }
}
