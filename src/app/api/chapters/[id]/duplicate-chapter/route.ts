/**
 * Chapter Duplication API
 *
 * POST /api/chapters/:id/duplicate-chapter
 *
 * Next.js App Router wrapper around the Payload endpoint
 * `duplicateChapterEndpoint`. Mirrors the sibling course/lesson/exercise
 * duplicate wrappers.
 *
 * Why this file exists: Payload 3.x's REST adapter at `/api/[...slug]` only
 * looks up custom endpoints under a collection path (e.g. `/api/chapters/...`)
 * in `collection.config.endpoints[]`, NOT in the root `config.endpoints[]`.
 * Registering an endpoint at `/chapters/:id/duplicate-chapter` in
 * `payload.config.ts` alone yields 404s for routes under a collection slug —
 * so every "custom endpoint under /api/{collection-slug}/..." needs an
 * explicit Next.js route wrapper like this one.
 *
 * @fileType api-route
 * @domain chapter-duplication
 * @pattern payload-endpoint-wrapper
 * @ai-summary Forwards POST to the Payload chapter-duplicate endpoint with auth + payload context attached.
 *
 * Access: admin only (enforced inside the endpoint handler).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

import { duplicateChapterEndpoint } from '@/server/payload/endpoints/chapters/duplicate'

// Match the 800s ceiling the course/lesson duplicate wrappers use. A fat
// chapter clone (~40 lessons × 15 exercises × 5 sections ≈ 3000 docs) goes
// through the bulk-insertMany path and should finish in under a minute, but
// keeping headroom means a slower cold-start or Mongo blip doesn't guillotine
// the clone halfway through.
export const maxDuration = 800

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
      // may — leaving it undefined would surface as a hard-to-trace
      // `Cannot read properties of undefined`.
      context: {},
      json: async () => body,
    } as unknown as Parameters<typeof duplicateChapterEndpoint>[0]

    return await duplicateChapterEndpoint(payloadRequest)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (payload) {
      payload.logger.error(`[duplicate-chapter route] ${detail}`)
    } else {
      console.error(`[duplicate-chapter route] ${detail}`)
    }
    return NextResponse.json(
      { error: 'Chapter duplicate failed. Check server logs for details.' },
      { status: 500 },
    )
  }
}
