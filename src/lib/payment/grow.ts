/**
 * Grow (formerly Meshulam) Payment Service — Light API
 *
 * Minimal first-pass client used by the admin test harness. Grow docs:
 *   https://developers.grow.business/
 *
 * The Light API covers hosted checkout, tokenization, recurring, invoices and
 * webhooks in a single JSON API. All calls must originate server-side; Grow
 * blocks browser-origin requests.
 *
 * Webhook authenticity is a shared secret echoed back inside the JSON body
 * (`webhookKey`), not an HMAC header — reject anything else at the edge.
 */

import { getPaymentEnv } from './env'

const GROW_SANDBOX_BASE = 'https://sandbox.meshulam.co.il'
const GROW_PRODUCTION_BASE = 'https://api.meshulam.co.il'

function getGrowApiBase(): string {
  const { growSandbox } = getPaymentEnv()
  return growSandbox ? GROW_SANDBOX_BASE : GROW_PRODUCTION_BASE
}

export interface CreateGrowCheckoutOptions {
  sum: number // ILS, decimal (e.g. 1 = ₪1.00, 29.9 = ₪29.90)
  description: string
  successUrl: string
  cancelUrl: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  // cField1-9 round-trip through the webhook — use them to correlate the
  // callback to a Payload userId / productId / transactionId.
  cField1?: string
  cField2?: string
  cField3?: string
  notifyUrl?: string
}

export interface GrowCheckoutResult {
  checkoutUrl: string
  processId: string
}

interface GrowCreateProcessResponse {
  status: 0 | 1
  err?: string
  data?: {
    url?: string
    processId?: string
  }
}

/**
 * Create a one-time hosted-checkout session.
 * Returns the URL to redirect the customer to.
 */
export async function createGrowCheckout(
  options: CreateGrowCheckoutOptions,
): Promise<GrowCheckoutResult> {
  const { growUserId, growPageCode } = getPaymentEnv()

  const body: Record<string, string | number> = {
    userId: growUserId,
    pageCode: growPageCode,
    chargeType: 1, // regular (one-time)
    sum: options.sum,
    description: options.description,
    successUrl: options.successUrl,
    cancelUrl: options.cancelUrl,
    'pageField[fullName]': options.customerName,
    'pageField[phone]': options.customerPhone,
  }
  if (options.customerEmail) body['pageField[email]'] = options.customerEmail
  if (options.cField1) body.cField1 = options.cField1
  if (options.cField2) body.cField2 = options.cField2
  if (options.cField3) body.cField3 = options.cField3
  if (options.notifyUrl) body.notifyUrl = options.notifyUrl

  const response = await fetch(`${getGrowApiBase()}/api/light/server/1.0/createPaymentProcess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, String(v)]),
    ).toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Grow createPaymentProcess HTTP ${response.status}: ${text}`)
  }

  const data = (await response.json()) as GrowCreateProcessResponse
  if (data.status !== 1 || !data.data?.url) {
    throw new Error(`Grow createPaymentProcess failed: ${data.err ?? JSON.stringify(data)}`)
  }

  return {
    checkoutUrl: data.data.url,
    processId: data.data.processId ?? '',
  }
}

/**
 * Verify a Grow webhook body. Grow's only auth is a shared `webhookKey` field
 * inside the JSON — if it doesn't match our env, the request is forged/stale.
 */
export function verifyGrowWebhook(body: unknown): boolean {
  const { growWebhookKey } = getPaymentEnv()
  if (!growWebhookKey) return false
  if (!body || typeof body !== 'object') return false
  const key = (body as { webhookKey?: unknown }).webhookKey
  return typeof key === 'string' && key === growWebhookKey
}
