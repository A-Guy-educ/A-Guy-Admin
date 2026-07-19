/**
 * POST /api/course-selections
 * Next.js route wrapper for the course-selection logging endpoint.
 *
 * CORS: the Web app calls this endpoint cross-origin, so this route carries an
 * explicit OPTIONS preflight handler and CORS headers on every POST response.
 * See `src/lib/http/cors.ts` for the allowlist + header rules.
 */
import { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import type { PayloadRequest } from 'payload'
import config from '@payload-config'

import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import { logCourseSelection } from '@/server/payload/endpoints/course-selections/log-selection'

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request)
}

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    const body = await request.json().catch(() => null)

    const payloadRequest = {
      payload,
      user: user || undefined,
      url: request.url,
      headers: request.headers,
      json: async () => body,
      routeParams: {},
      context: {},
    } as PayloadRequest & { json: () => Promise<unknown> }

    const res = await logCourseSelection(payloadRequest)
    return applyCorsHeaders(res, request)
  } catch (error) {
    const errorResponse = Response.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
    return applyCorsHeaders(errorResponse, request)
  }
}
