/**
 * Content Promotion — Export
 *
 * GET /api/content-promotion/export?courseIds=<id1>,<id2>
 * Streams a zip bundle containing the selected courses plus their chapters,
 * lessons, exercises, and referenced media (records + binary blobs) for
 * promotion to a different environment via the matching import endpoint.
 *
 * At least one course ID is required — the admin UI enforces this client-side
 * and the route rejects missing/empty `courseIds` with 400. The whole-DB
 * variant was removed because typical use (promote one or two new courses)
 * was timing out the Vercel function on large dev datasets.
 */
import configPromise from '@payload-config'
import type { PayloadRequest } from 'payload'
import { getPayload } from 'payload'
import { NextRequest, NextResponse } from 'next/server'
import type { User } from 'payload'

import { requireAdmin } from '@/server/api/auth'
import { ApiErrors, apiError } from '@/server/api/responses'
import { exportContent } from '@/server/services/content-promotion/export-content'

function parseCourseIds(request: NextRequest): string[] {
  const raw = request.nextUrl.searchParams.get('courseIds')
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const payload = await getPayload({ config: configPromise })
    const { user } = await payload.auth({ headers: request.headers })

    try {
      requireAdmin(user as User | null)
    } catch {
      return ApiErrors.unauthorized('Admin access required')
    }

    const courseIds = parseCourseIds(request)
    if (courseIds.length === 0) {
      return apiError(
        'BAD_REQUEST',
        'At least one `courseIds` value is required (comma-separated)',
        400,
      )
    }

    const payloadReq = {
      payload,
      user: user as User,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const { zipBuffer, report } = await exportContent(payload, payloadReq, { courseIds })

    payload.logger.info({ report, courseIds }, '[content-promotion/export] Bundle built')

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
