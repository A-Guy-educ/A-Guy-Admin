/**
 * PATCH /api/users/me/course-state
 * Next.js route wrapper for the self-write course-state endpoint.
 *
 * CORS: called cross-origin from the Web app with credentials: 'include'.
 * See `src/lib/http/cors.ts` for the allowlist + header rules.
 */
import { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import type { PayloadRequest } from 'payload'
import config from '@payload-config'

import { applyCorsHeaders, createPreflightResponse } from '@/lib/http/cors'
import { updateCourseState } from '@/server/payload/endpoints/users-me-course-state/update-course-state'

export async function OPTIONS(request: NextRequest) {
  return createPreflightResponse(request)
}

export async function PATCH(request: NextRequest) {
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

    const res = await updateCourseState(payloadRequest)
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
