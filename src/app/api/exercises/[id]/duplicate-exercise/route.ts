/**
 * Exercise Duplication API
 *
 * POST /api/exercises/:id/duplicate-exercise
 *
 * Next.js App Router wrapper around the Payload endpoint
 * `duplicateExerciseEndpoint`. Path uses /duplicate-exercise (not
 * /duplicate) to avoid Payload's built-in collection duplicate handler,
 * which would otherwise shadow this route with a shallow field copy that
 * doesn't clone the exercise's sections (see the sibling
 * `/api/courses/:id/duplicate-course` route for the identical rationale).
 *
 * @fileType api-route
 * @domain exercise-duplication
 * @pattern payload-endpoint-wrapper
 * @ai-summary Forwards POST to the Payload exercise-duplicate endpoint with auth + payload context attached.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

import { duplicateExerciseEndpoint } from '@/server/payload/endpoints/exercises/duplicate'

// Single-exercise clones are small (a handful of sections at most). The
// default Vercel timeout (300s) is more than enough — leaving the ceiling
// at the platform default here on purpose, rather than the longer 800s
// budget the course/lesson endpoints request.

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
      // `context` is Payload's per-request scratchpad. Downstream hooks
      // read from it (e.g. `_skipExerciseBlockSync` on section clones);
      // leaving it undefined would surface as a hard-to-trace
      // `Cannot read properties of undefined`.
      context: {},
      json: async () => body,
    } as unknown as Parameters<typeof duplicateExerciseEndpoint>[0]

    return await duplicateExerciseEndpoint(payloadRequest)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (payload) {
      payload.logger.error(`[duplicate-exercise route] ${detail}`)
    } else {
      console.error(`[duplicate-exercise route] ${detail}`)
    }
    return NextResponse.json(
      { error: 'Exercise duplicate failed. Check server logs for details.' },
      { status: 500 },
    )
  }
}
