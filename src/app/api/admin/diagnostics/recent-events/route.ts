/**
 * @fileType api-route
 * @domain admin/diagnostics
 * @ai-summary Admin-only diagnostic endpoint that dumps the in-memory
 *   [boot]/[op]/[coll] event buffer as JSON. Lets us diagnose cold-start
 *   and per-request timings by hitting a URL in a browser tab instead of
 *   racing Vercel's log stream (which caps at 5 min and has 30-60s
 *   propagation delay).
 *
 *   Buffer is per-lambda-instance and per-process, so if Vercel routes
 *   admin requests and this diagnostic hit to different instances, the
 *   response will reflect only THIS instance's history — retry a few
 *   times to catch the instance that served the admin request you care
 *   about, or hit the admin URL and this URL back-to-back.
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getRecentDiagEvents } from '@/infra/utils/diagnostics-buffer'
import { AccountRole } from '@/server/payload/collections/Users/roles'

export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<NextResponse> {
  const payload = await getPayload({ config })

  const authResult = await payload.auth({ headers: req.headers })
  if (!authResult.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (
    !('collection' in authResult.user) ||
    authResult.user.collection !== 'users' ||
    authResult.user.role !== AccountRole.Admin
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const data = getRecentDiagEvents()
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
