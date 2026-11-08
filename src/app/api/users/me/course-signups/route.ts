/**
 * POST/DELETE /api/users/me/course-signups
 * Next.js route wrapper for the course sign-up endpoints.
 *
 * No CORS: Web calls this from its server-side proxy with a service token, so
 * browsers never reach it cross-origin.
 */
import { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import type { PayloadRequest } from 'payload'
import config from '@payload-config'

import { logger } from '@/infra/utils/logger'
import { addCourseSignup } from '@/server/payload/endpoints/users-me-course-signups/add-course-signup'
import { removeCourseSignup } from '@/server/payload/endpoints/users-me-course-signups/remove-course-signup'

type SignupHandler = typeof addCourseSignup

async function handle(request: NextRequest, handler: SignupHandler) {
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

    return await handler(payloadRequest)
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      `${request.method} /api/users/me/course-signups failed`,
    )
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return handle(request, addCourseSignup)
}

export async function DELETE(request: NextRequest) {
  return handle(request, removeCourseSignup)
}
