/**
 * GET /api/course-selections/popularity
 * Next.js route wrapper for the popularity aggregation handler.
 *
 * Admin-only. Supports `gradeLevel` and `source` query parameters.
 */
import { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import type { PayloadRequest } from 'payload'
import config from '@payload-config'

import { getCourseSelectionPopularity } from '@/server/payload/endpoints/course-selections/popularity'

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })

    const payloadRequest = {
      payload,
      user: user || undefined,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: {},
    } as PayloadRequest

    return await getCourseSelectionPopularity(payloadRequest)
  } catch (error) {
    return Response.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
