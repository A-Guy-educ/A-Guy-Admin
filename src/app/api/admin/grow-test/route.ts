/**
 * Admin Grow Test Harness
 *
 * GET /api/admin/grow-test
 *
 * Smoke-tests the Grow payment integration end-to-end:
 *   1. Admin hits this endpoint on the dev preview
 *   2. Server calls Grow createPaymentProcess for a 1 ILS test charge
 *   3. Response includes the Grow hosted-checkout URL
 *   4. Admin opens the URL, pays with Grow's sandbox test card
 *   5. Grow fires a webhook at /api/webhooks/grow — see logs for payload shape
 *
 * No DB writes. Admin-only. Remove once Grow is wired into Products/Transactions.
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { createGrowCheckout } from '@/lib/payment/grow'
import { AccountRole } from '@/server/payload/collections/Users/roles'

export async function GET(req: Request) {
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

  const url = new URL(req.url)
  const origin = `${url.protocol}//${url.host}`

  try {
    const result = await createGrowCheckout({
      sum: 1,
      description: 'Grow sandbox smoke test',
      successUrl: `${origin}/admin?growTest=success`,
      cancelUrl: `${origin}/admin?growTest=cancel`,
      customerName: 'Test User',
      customerPhone: '0500000000',
      customerEmail: authResult.user.email,
      cField1: String(authResult.user.id),
      cField2: 'grow-smoke-test',
      notifyUrl: `${origin}/api/webhooks/grow`,
    })

    payload.logger.info(
      { processId: result.processId, checkoutUrl: result.checkoutUrl },
      '[grow-test] created checkout',
    )

    return NextResponse.json({
      ok: true,
      checkoutUrl: result.checkoutUrl,
      processId: result.processId,
      hint: 'Open checkoutUrl in a browser, pay with Grow sandbox test card, watch Vercel logs for [grow-webhook] payload.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    payload.logger.error({ err: message }, '[grow-test] createCheckout failed')
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
