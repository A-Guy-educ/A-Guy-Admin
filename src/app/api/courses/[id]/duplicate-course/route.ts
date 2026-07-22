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
  let payload: Awaited<ReturnType<typeof getPayload>> | undefined
  try {
    payload = await getPayload({ config: configPromise })
    const { user } = await payload.auth({ headers: request.headers })

    const body = await request.json().catch(() => ({}))

    const payloadRequest = {
      payload,
      user,
      url: request.url,
      headers: request.headers,
      // `context` is Payload's per-request scratchpad. The endpoint currently
      // doesn't read it, but downstream hooks passed on this synthetic req
      // (e.g. anything that toggles `_skipBlockSync`) do — leaving it undefined
      // would surface as a hard-to-trace `Cannot read properties of undefined`.
      context: {},
      json: async () => body,
    } as unknown as Parameters<typeof duplicateCourseEndpoint>[0]

    return await duplicateCourseEndpoint(payloadRequest)
  } catch (error) {
    // Log the full error server-side; return a scrubbed message to the client.
    // The endpoint is admin-only, so leak risk is low, but raw exception text
    // can carry field/collection names and stack fragments that make debugging
    // via the browser noisier than reading server logs.
    const detail = error instanceof Error ? error.message : String(error)
    if (payload) {
      payload.logger.error(`[duplicate-course route] ${detail}`)
    } else {
      console.error(`[duplicate-course route] ${detail}`)
    }
    return NextResponse.json(
      { error: 'Course duplicate failed. Check server logs for details.' },
      { status: 500 },
    )
  }
}
