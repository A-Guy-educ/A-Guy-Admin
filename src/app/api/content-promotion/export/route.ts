/**
 * Content Promotion — Export
 *
 * GET /api/content-promotion/export
 * Streams a zip bundle containing the `media`, `courses`, `chapters`, `lessons`,
 * and `exercises` collections (records + binary blobs) for promotion to a
 * different environment via the matching import endpoint.
 */
import configPromise from '@payload-config'
import type { PayloadRequest } from 'payload'
import { getPayload } from 'payload'
import { NextRequest, NextResponse } from 'next/server'
import type { User } from 'payload'

import { requireAdmin } from '@/server/api/auth'
import { ApiErrors, apiError } from '@/server/api/responses'
import { exportContent } from '@/server/services/content-promotion/export-content'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const payload = await getPayload({ config: configPromise })
    const { user } = await payload.auth({ headers: request.headers })

    try {
      requireAdmin(user as User | null)
    } catch {
      return ApiErrors.unauthorized('Admin access required')
    }

    const payloadReq = {
      payload,
      user: user as User,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const { zipBuffer, report } = await exportContent(payload, payloadReq)

    payload.logger.info({ report }, '[content-promotion/export] Bundle built')

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const arrayBuffer = zipBuffer.buffer.slice(
      zipBuffer.byteOffset,
      zipBuffer.byteOffset + zipBuffer.byteLength,
    ) as ArrayBuffer

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="content-bundle-${ts}.zip"`,
        'Content-Length': String(zipBuffer.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Promotion-Report': JSON.stringify(report),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return apiError('INTERNAL_ERROR', `Export failed: ${message}`, 500)
  }
}

export function POST(): NextResponse {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
