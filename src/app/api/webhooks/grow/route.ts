/**
 * Grow Webhook Handler — SMOKE TEST VERSION
 *
 * POST /api/webhooks/grow
 *
 * First-pass handler: verify the shared `webhookKey` and log the full payload.
 * No DB writes yet — the goal is to confirm Grow actually calls us back and
 * document the exact JSON shape it sends for a sandbox transaction before we
 * wire this into Transactions/entitlements.
 *
 * Status mapping, dedup, and entitlement granting land in a follow-up once
 * we've seen a real payload.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { verifyGrowWebhook } from '@/lib/payment/grow'

export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    // Grow may send form-encoded if "Array" format is selected in the dashboard
    // — JSON format is the one we expect. Log the raw body to catch misconfig.
    const raw = await request.text().catch(() => '')
    payload.logger.warn({ raw: raw.slice(0, 500) }, '[grow-webhook] non-JSON body')
    return NextResponse.json({ error: 'Expected JSON body' }, { status: 400 })
  }

  if (!verifyGrowWebhook(body)) {
    const sourceIp =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    payload.logger.warn(
      { sourceIp, body },
      '[grow-webhook] webhookKey mismatch — rejecting',
    )
    return NextResponse.json({ error: 'Invalid webhookKey' }, { status: 401 })
  }

  payload.logger.info({ body }, '[grow-webhook] verified payload')

  return NextResponse.json({ received: true }, { status: 200 })
}
