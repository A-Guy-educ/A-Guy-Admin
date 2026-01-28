/**
 * POST /api/cron/media-expiry
 * API route for media expiry cleanup cron job
 */
import { getPayload } from 'payload'
import configPromise from '@payload-config'

import { mediaExpiryCleanupEndpoint } from '@/server/payload/endpoints/cron/media-expiry'

export async function POST(request: Request) {
  const payload = await getPayload({ config: configPromise })

  // Create a minimal request object compatible with the endpoint
  const payloadRequest = {
    payload,
    headers: request.headers,
  } as Parameters<typeof mediaExpiryCleanupEndpoint.handler>[0]

  return await mediaExpiryCleanupEndpoint.handler(payloadRequest)
}
