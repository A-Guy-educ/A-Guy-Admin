/**
 * Tranzilla Payment Service — Light API
 *
 * First-pass client mirroring the Grow smoke-test shape. Tranzilla docs:
 *   https://docs.tranzila.com/
 *
 * This file covers only the hosted-iframe redirect flow:
 *   `https://direct.tranzila.com/<terminal>/iframenew.php`
 *
 * The buyer-facing page is served by Tranzilla. No API key is needed to build
 * this URL; the terminal name alone identifies the merchant. Custom `u71..u79`
 * fields round-trip verbatim through the notify_url POST, so we use them to
 * correlate the webhook back to a Payload userId / productId / transactionId.
 *
 * Direct charges, refunds, and transaction queries via the TranzilaPG REST API
 * live elsewhere — the endpoint paths and HMAC-header shape need to be
 * confirmed with Tranzilla support before we build against them (an earlier
 * guess at `/v1/transaction/search` returned 404 in production). See follow-up
 * work in the admin.aguy.co.il/tranzilla-support thread.
 *
 * Webhook authenticity: Tranzilla's notify_url POST does NOT carry a signed
 * header by default. When `response_hash` is present in the body (merchant
 * enabled the signing feature in the terminal dashboard), we HMAC-verify it
 * with the private key. When it's absent, the webhook handler falls back to
 * log-and-accept, matching how Grow was wired on its first pass.
 */

import crypto from 'node:crypto'

import { getPaymentEnv } from './env'

const TRANZILLA_DIRECT_BASE = 'https://direct.tranzila.com'

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
