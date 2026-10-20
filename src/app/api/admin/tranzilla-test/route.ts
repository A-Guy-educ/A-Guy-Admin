/**
 * Admin Tranzilla Test Harness
 *
 * GET /api/admin/tranzilla-test
 *
 * Smoke-tests the Tranzilla payment integration end-to-end:
 *   1. Admin hits this endpoint on the dev preview
 *   2. Server builds a hosted-checkout URL for a 1 ILS test charge
 *   3. Response includes the Tranzilla hosted-checkout URL
 *   4. Admin opens the URL, pays with Tranzilla's sandbox test card
 *   5. Tranzilla fires a POST at /api/webhooks/tranzilla — see logs for payload shape
 *
 * Query params:
 *   ?token=1   use the tokenization terminal (fxpaguytok) instead of the regular one
 *
 * No DB writes. Admin-only. Remove once Tranzilla is wired into Products / Transactions.
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { createTranzillaCheckout } from '@/lib/payment/tranzilla'
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
  const useTokenTerminal = url.searchParams.get('token') === '1'

  try {
    const result = await createTranzillaCheckout({
      sum: 1,
      currency: 'ILS',
      description: 'Tranzilla sandbox smoke test',
      successUrl: `${origin}/admin?tranzillaTest=success`,
      cancelUrl: `${origin}/admin?tranzillaTest=cancel`,
      notifyUrl: `${origin}/api/webhooks/tranzilla`,
      customerName: 'Test User',
      customerEmail: authResult.user.email,
      customerPhone: '0500000000',
      lang: 'il',
      hideLogo: true,
      credType: useTokenTerminal ? 6 : 1,
      useTokenTerminal,
      cField1: String(authResult.user.id),
      cField2: 'tranzilla-smoke-test',
    })

    payload.logger.info(
      { terminal: result.terminal, checkoutUrl: result.checkoutUrl, useTokenTerminal },
      '[tranzilla-test] created checkout',
    )

    return NextResponse.json({
      ok: true,
      checkoutUrl: result.checkoutUrl,
      terminal: result.terminal,
      hint: 'Open checkoutUrl in a browser, pay with a Tranzilla sandbox test card, watch logs for [tranzilla-webhook] payload.',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    payload.logger.error({ err: message }, '[tranzilla-test] createCheckout failed')
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
