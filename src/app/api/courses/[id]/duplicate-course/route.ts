/**
 * Course Duplication API
 *
 * POST /api/courses/:id/duplicate-course
 *
 * Next.js App Router wrapper around the Payload endpoint
 * `duplicateCourseEndpoint`. The path is deliberately /duplicate-course (not
 * /duplicate) because Payload's built-in collection duplicate handler also
 * claims /api/courses/:id/duplicate and would silently run its field-copy
 * before our endpoint could answer.
 *
 * @fileType api-route
 * @domain course-duplication
 * @pattern payload-endpoint-wrapper
 * @ai-summary Forwards POST to the Payload course-duplicate endpoint with auth + payload context attached.
 *
 * Access: admin only (enforced inside the endpoint handler).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

import { duplicateCourseEndpoint } from '@/server/payload/endpoints/courses/duplicate'

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  try {
    const payload = await getPayload({ config: configPromise })
    const { user } = await payload.auth({ headers: request.headers })

    const body = await request.json().catch(() => ({}))

    const payloadRequest = {
      payload,
      user,
      url: request.url,
      headers: request.headers,
      json: async () => body,
    } as unknown as Parameters<typeof duplicateCourseEndpoint>[0]

    return await duplicateCourseEndpoint(payloadRequest)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Course duplicate endpoint failed: ${message}` },
      { status: 500 },
    )
  }
}
