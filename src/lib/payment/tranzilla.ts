/**
 * Tranzilla Payment Service — Light API
 *
 * First-pass client mirroring the Grow smoke-test shape. Tranzilla docs:
 *   https://docs.tranzila.com/
 *
 * Two integration surfaces matter here:
 *
 * 1. Hosted iframe redirect (`https://direct.tranzila.com/<terminal>/iframenew.php`)
 *    — the buyer-facing checkout URL. No API key is needed to build this URL;
 *    the terminal name alone identifies the merchant. Custom `u71..u79` fields
 *    round-trip verbatim through the notify_url POST, so we use them to
 *    correlate the webhook back to a Payload userId / productId / transactionId.
 *
 * 2. TranzilaPG v4 REST API (`https://api.tranzila.com/v1/*`) — used for
 *    direct charges, refunds, and transaction queries. Requires HMAC-signed
 *    headers derived from public_key / private_key. Only used server-side.
 *
 * Webhook authenticity: Tranzilla's notify_url POST does NOT carry a signed
 * header by default. The verification options are:
 *   a) Enable `response_hash` in the terminal settings — Tranzilla then
 *      appends an HMAC-SHA256(private_key, Response|index|sum|...) field.
 *   b) Call back to `/v1/transaction/get` and confirm the transaction exists
 *      and matches the posted amount/index — this is the strongest signal
 *      because it bypasses any spoofing of the notify POST.
 *
 * The webhook handler enforces (a) when `response_hash` is present and falls
 * back to a smoke-test "log the payload" path otherwise, matching how Grow
 * was wired on its first pass.
 */

import crypto from 'node:crypto'

import { getPaymentEnv } from './env'

const TRANZILLA_DIRECT_BASE = 'https://direct.tranzila.com'
const TRANZILLA_API_BASE = 'https://api.tranzila.com'

export type TranzillaCurrency = 'ILS' | 'USD' | 'EUR' | 'GBP'

// Tranzilla currency codes: 1=ILS, 2=USD, 978=EUR, 826=GBP.
const TRANZILLA_CURRENCY_CODE: Record<TranzillaCurrency, number> = {
  ILS: 1,
  USD: 2,
  EUR: 978,
  GBP: 826,
}

export interface CreateTranzillaCheckoutOptions {
  /** Amount in major units (e.g. 1 = ₪1.00). Tranzilla accepts up to 2 decimals. */
  sum: number
  currency: TranzillaCurrency
  description: string
  successUrl: string
  cancelUrl: string
  notifyUrl: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  /** Hebrew UI (`il`) by default; `us` for English. */
  lang?: 'il' | 'us'
  /** Hide the Tranzilla logo on the hosted page. */
  hideLogo?: boolean
  /**
   * Charge type:
   *   1 — single payment (default)
   *   6 — tokenize card without charging (requires `fxpaguytok` terminal)
   *   8 — payments / credit
   */
  credType?: 1 | 6 | 8
  /**
   * Use the tokenization terminal instead of the regular one. Set this when
   * the goal is to capture a reusable token (TranzilaTK) for later recurring
   * charges without storing the card yourself.
   */
  useTokenTerminal?: boolean
  /**
   * Custom fields u71..u79 — round-trip verbatim through the notify_url POST.
   * Use these to correlate the callback to a Payload userId / productId /
   * transactionId.
   */
  cField1?: string
  cField2?: string
  cField3?: string
  cField4?: string
  cField5?: string
}

export interface TranzillaCheckoutResult {
  checkoutUrl: string
  terminal: string
}

/**
 * Build a hosted-checkout URL. The buyer-facing page is served by Tranzilla
 * on `direct.tranzila.com/<terminal>/iframenew.php`.
 *
 * This function never calls Tranzilla — it just builds a signed URL. The
 * actual charge happens when the buyer submits the card form.
 */
export function createTranzillaCheckout(
  options: CreateTranzillaCheckoutOptions,
): TranzillaCheckoutResult {
  const { tranzillaTerminal, tranzillaTerminalToken } = getPaymentEnv()

  const terminal = options.useTokenTerminal
    ? tranzillaTerminalToken || tranzillaTerminal
    : tranzillaTerminal

  if (!terminal) {
    throw new Error(
      options.useTokenTerminal
        ? 'TRANZILLA_TERMINAL_TOKEN is not set — cannot create a tokenization checkout.'
        : 'TRANZILLA_TERMINAL is not set — cannot create a Tranzilla checkout.',
    )
  }

  const params: Record<string, string> = {
    sum: options.sum.toFixed(2),
    currency: String(TRANZILLA_CURRENCY_CODE[options.currency]),
    cred_type: String(options.credType ?? 1),
    tranmode: 'A', // A = Charge
    pdesc: options.description,
    success_url_address: options.successUrl,
    fail_url_address: options.cancelUrl,
    notify_url_address: options.notifyUrl,
    lang: options.lang ?? 'il',
  }

  if (options.hideLogo) params.nologo = '1'
  if (options.customerName) params.contact = options.customerName
  if (options.customerEmail) params.email = options.customerEmail
  if (options.customerPhone) params.phone = options.customerPhone
  if (options.cField1) params.u71 = options.cField1
  if (options.cField2) params.u72 = options.cField2
  if (options.cField3) params.u73 = options.cField3
  if (options.cField4) params.u74 = options.cField4
  if (options.cField5) params.u75 = options.cField5

  const query = new URLSearchParams(params).toString()
  const checkoutUrl = `${TRANZILLA_DIRECT_BASE}/${terminal}/iframenew.php?${query}`

  return { checkoutUrl, terminal }
}

/**
 * Verify a Tranzilla notify_url POST body.
 *
 * Tranzilla's hosted-iframe `response_hash` is `HMAC-SHA256(private_key, body)`
 * where `body` is `index|sum|currency|Response` (pipe-joined, in that exact
 * order per Tranzilla's spec). When the merchant has NOT enabled response_hash
 * in the terminal settings, the field is absent and this function returns
 * `false` — upstream should either enable it or fall back to the stronger
 * `queryTranzillaTransaction()` round-trip check.
 */
export function verifyTranzillaWebhook(body: Record<string, string>): boolean {
  const { tranzillaPrivateKey } = getPaymentEnv()
  if (!tranzillaPrivateKey) return false

  const providedHash = body.response_hash
  if (!providedHash || typeof providedHash !== 'string') return false

  const index = body.index ?? ''
  const sum = body.sum ?? ''
  const currency = body.currency ?? ''
  const response = body.Response ?? body.response ?? ''

  const payloadToSign = `${index}|${sum}|${currency}|${response}`
  const expected = crypto
    .createHmac('sha256', tranzillaPrivateKey)
    .update(payloadToSign)
    .digest('hex')

  // Timing-safe compare. Reject length mismatches up front to avoid throwing
  // in timingSafeEqual.
  if (expected.length !== providedHash.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedHash))
}

/**
 * Build the HMAC auth headers for TranzilaPG v4 REST API calls.
 *
 * See https://docs.tranzila.com/#section/Authentication — the access token is
 * `HMAC-SHA256(private_key, nonce)` and must be sent alongside the public key,
 * nonce, and request timestamp. Nonces are single-use within the TTL window.
 */
function buildTranzillaApiHeaders(): Record<string, string> {
  const { tranzillaPublicKey, tranzillaPrivateKey } = getPaymentEnv()
  if (!tranzillaPublicKey || !tranzillaPrivateKey) {
    throw new Error('TRANZILLA_PUBLIC_KEY / TRANZILLA_PRIVATE_KEY not configured')
  }

  const nonce = crypto.randomBytes(40).toString('hex') // 80 chars
  const requestTime = Math.floor(Date.now() / 1000).toString()
  const accessToken = crypto.createHmac('sha256', tranzillaPrivateKey).update(nonce).digest('hex')

  return {
    'Content-Type': 'application/json',
    'X-tranzila-api-app-key': tranzillaPublicKey,
    'X-tranzila-api-request-time': requestTime,
    'X-tranzila-api-nonce': nonce,
    'X-tranzila-api-access-token': accessToken,
  }
}

export interface TranzillaTransactionInfo {
  index: string
  sum: number
  currency: string
  status: string
  confirmationCode?: string
  raw: unknown
}

/**
 * Query a Tranzilla transaction by its index. Use this to confirm a notify_url
 * POST was genuine — if the posted index matches a real transaction with the
 * same amount, the callback is authentic even without response_hash.
 */
export async function queryTranzillaTransaction(
  index: string,
): Promise<TranzillaTransactionInfo | null> {
  const { tranzillaTerminal } = getPaymentEnv()
  if (!tranzillaTerminal) {
    throw new Error('TRANZILLA_TERMINAL not configured')
  }

  const response = await fetch(`${TRANZILLA_API_BASE}/v1/transaction/search`, {
    method: 'POST',
    headers: buildTranzillaApiHeaders(),
    body: JSON.stringify({
      terminal_name: tranzillaTerminal,
      filter: { index: Number(index) },
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Tranzilla transaction/search HTTP ${response.status}: ${text}`)
  }

  const data = (await response.json()) as {
    transactions_list?: Array<{
      index?: number
      sum?: number
      currency_code?: string
      transaction_status?: string
      confirmation_code?: string
    }>
  }

  const first = data.transactions_list?.[0]
  if (!first || first.index === undefined) return null

  return {
    index: String(first.index),
    sum: Number(first.sum ?? 0),
    currency: String(first.currency_code ?? ''),
    status: String(first.transaction_status ?? ''),
    confirmationCode: first.confirmation_code,
    raw: data,
  }
}

/**
 * Refund a captured Tranzilla transaction via the v4 REST API.
 *
 * @param index - Tranzilla's transaction index (from the original notify POST).
 * @param amount - Optional partial-refund amount in major units; defaults to a
 *                 full refund of the original sum.
 */
export async function refundTranzilla(index: string, amount?: number): Promise<void> {
  const { tranzillaTerminal } = getPaymentEnv()
  if (!tranzillaTerminal) {
    throw new Error('TRANZILLA_TERMINAL not configured')
  }

  const body: Record<string, unknown> = {
    terminal_name: tranzillaTerminal,
    original_index: Number(index),
  }
  if (amount !== undefined) body.amount = Number(amount.toFixed(2))

  const response = await fetch(`${TRANZILLA_API_BASE}/v1/transaction/refund`, {
    method: 'POST',
    headers: buildTranzillaApiHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Tranzilla refund HTTP ${response.status}: ${text}`)
  }
}
