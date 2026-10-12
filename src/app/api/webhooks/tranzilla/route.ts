/**
 * Tranzilla Webhook Handler — SMOKE TEST VERSION
 *
 * POST /api/webhooks/tranzilla
 *
 * First-pass handler: parse the notify_url POST, verify authenticity (via
 * `response_hash` when enabled on the terminal, otherwise via a round-trip
 * `/v1/transaction/search` call), and log the full payload. No DB writes yet
 * — the goal is to confirm Tranzilla actually calls us back and document the
 * exact field shape it sends for a sandbox transaction before we wire this
 * into Transactions / entitlements.
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
import { queryTranzillaTransaction, verifyTranzillaWebhook } from '@/lib/payment/tranzilla'

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

  // Primary auth path: HMAC-SHA256 response_hash when the terminal is
  // configured for it.
  const hasHash = typeof body.response_hash === 'string' && body.response_hash.length > 0
  let authed = false
  let authMethod: 'response_hash' | 'transaction_lookup' | 'none' = 'none'

  if (hasHash) {
    authed = verifyTranzillaWebhook(body)
    authMethod = 'response_hash'
    if (!authed) {
      const sourceIp =
        request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
      payload.logger.warn(
        { sourceIp, index: body.index },
        '[tranzilla-webhook] response_hash mismatch — rejecting',
      )
      return NextResponse.json({ error: 'Invalid response_hash' }, { status: 401 })
    }
  } else if (body.index) {
    // Fallback: round-trip to Tranzilla and confirm the transaction exists
    // with the posted sum. This cannot be spoofed by an attacker because
    // the search is HMAC-signed with our private key.
    try {
      const info = await queryTranzillaTransaction(body.index)
      const postedSum = Number(body.sum ?? NaN)
      if (
        info &&
        Number.isFinite(postedSum) &&
        Math.abs(info.sum - postedSum) < 0.01 &&
        info.status.toUpperCase() !== 'FAILED'
      ) {
        authed = true
        authMethod = 'transaction_lookup'
      }
    } catch (err) {
      payload.logger.warn(
        { err: err instanceof Error ? err.message : String(err), index: body.index },
        '[tranzilla-webhook] transaction lookup failed — rejecting',
      )
    }
  }

  if (!authed) {
    const sourceIp =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    payload.logger.warn(
      { sourceIp, index: body.index, hasHash },
      '[tranzilla-webhook] unauthenticated — rejecting. Enable response_hash in the Tranzilla terminal settings or ensure TRANZILLA_PUBLIC_KEY / TRANZILLA_PRIVATE_KEY allow transaction lookup.',
    )
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
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
      u71: body.u71,
      u72: body.u72,
      u73: body.u73,
    },
    '[tranzilla-webhook] verified payload',
  )

  return NextResponse.json({ received: true }, { status: 200 })
}
