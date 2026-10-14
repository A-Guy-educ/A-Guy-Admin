/**
 * Tranzilla Webhook Handler — SMOKE TEST VERSION
 *
 * POST /api/webhooks/tranzilla
 *
 * First-pass handler: parse the notify_url POST, verify authenticity (via
 * `response_hash` when the merchant has enabled signing in the terminal
 * dashboard), and log the full payload. No DB writes yet — the goal is to
 * confirm Tranzilla actually calls us back and document the exact field shape
 * it sends for a sandbox transaction before we wire this into Transactions /
 * entitlements.
 *
 * Auth strategy:
 *   - If `response_hash` is in the body → HMAC-verify it with the private
 *     key; reject on mismatch.
 *   - If `response_hash` is absent → log-and-accept (same as Grow's smoke
 *     test). Production hardening will tighten this once we've confirmed the
 *     correct Tranzilla verification mechanism with their support team.
 *
 * Tranzilla POSTs form-encoded data (not JSON). Expected fields on success:
 *   Response (000 = approved)
 *   index                 (Tranzilla transaction id — the one we persist)
 *   ConfirmationCode
 *   sum, currency, cred_type
 *   pdesc
 *   u71..u79              (round-tripped custom fields — correlate here)
 *   TranzilaTK            (card token, when the tokenization terminal is used)
 *   card_type, last4
 *   response_hash         (only when enabled in terminal settings)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { verifyTranzillaWebhook } from '@/lib/payment/tranzilla'

export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })

  // Tranzilla POSTs application/x-www-form-urlencoded by default. We also
  // accept JSON for test harnesses.
  const contentType = request.headers.get('content-type') ?? ''
  let body: Record<string, string>
  try {
    if (contentType.includes('application/json')) {
      body = (await request.json()) as Record<string, string>
    } else {
      const text = await request.text()
      body = Object.fromEntries(new URLSearchParams(text).entries())
    }
  } catch (err) {
    payload.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[tranzilla-webhook] failed to parse body',
    )
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const hasHash = typeof body.response_hash === 'string' && body.response_hash.length > 0
  let authMethod: 'response_hash' | 'unsigned' = 'unsigned'

  if (hasHash) {
    const ok = verifyTranzillaWebhook(body)
    if (!ok) {
      const sourceIp =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      payload.logger.warn(
        { sourceIp, index: body.index },
        '[tranzilla-webhook] response_hash mismatch — rejecting',
      )
      return NextResponse.json({ error: 'Invalid response_hash' }, { status: 401 })
    }
    authMethod = 'response_hash'
  }

  payload.logger.info(
    {
      authMethod,
      index: body.index,
      response: body.Response ?? body.response,
      sum: body.sum,
      currency: body.currency,
      confirmationCode: body.ConfirmationCode,
      hasToken: Boolean(body.TranzilaTK),
      cardType: body.card_type,
      last4: body.last4,
      u71: body.u71,
      u72: body.u72,
      u73: body.u73,
    },
    '[tranzilla-webhook] payload received',
  )

  return NextResponse.json({ received: true }, { status: 200 })
}
