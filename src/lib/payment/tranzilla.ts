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
 * The ordered field list that the outgoing Hand Shake signature covers.
 * Mirrors the inbound `response_hash` shape — four pipe-joined fields that
 * must not be tampered with on the wire: sum (price), currency, cred_type
 * (payment type), tranmode (charge vs auth). A MITM attacker who altered
 * any of these could change price, currency, or the whole transaction mode;
 * everything else in the iframe URL is either operational (URLs, lang) or
 * already correlated via our custom u72/u73 fields.
 *
 * NOT YET VERIFIED against Tranzila's official Hand Shake spec. If the
 * terminal rejects the signed URL once Hand Shake is enabled on their side,
 * the fix is in this one array — extend or reorder, then re-smoke. The
 * TRANZILLA_HAND_SHAKE_ENABLED env flag means we can ship this code with
 * zero behavior change while that confirmation is pending.
 */
export const TRANZILLA_HAND_SHAKE_SIGNED_FIELDS = [
  'sum',
  'currency',
  'cred_type',
  'tranmode',
] as const

/**
 * Compute the Hand Shake signature over the outgoing iframe URL fields.
 *
 * Shape mirrors `verifyTranzillaWebhook`'s inbound verification: pipe-joined
 * values, HMAC-SHA256 with the private key, hex-encoded. The same private
 * key signs both directions in Tranzila's Hand Shake model.
 *
 * Exported for unit tests; the live call-site is `createTranzillaCheckout`.
 */
export function signCheckoutParams(args: {
  privateKey: string
  params: Record<string, string>
  signedFields?: readonly string[]
}): string {
  const { privateKey, params } = args
  const signedFields = args.signedFields ?? TRANZILLA_HAND_SHAKE_SIGNED_FIELDS
  if (!privateKey) {
    throw new Error('signCheckoutParams: privateKey required')
  }
  const payload = signedFields.map((f) => params[f] ?? '').join('|')
  return crypto.createHmac('sha256', privateKey).update(payload).digest('hex')
}

/**
 * Build a hosted-checkout URL. The buyer-facing page is served by Tranzilla
 * on `direct.tranzila.com/<terminal>/iframenew.php`.
 *
 * This function never calls Tranzilla — it just builds a signed URL. The
 * actual charge happens when the buyer submits the card form.
 *
 * Hand Shake: when `TRANZILLA_HAND_SHAKE_ENABLED=true`, a `response_hash`
 * query param is appended, computed over the critical money fields. Default
 * off — the iframe URL stays identical to today's unsigned shape until Shai
 * is ready to flip Hand Shake on at the terminal dashboard. See the signed-
 * fields constant above for the exact HMAC input layout.
 */
export function createTranzillaCheckout(
  options: CreateTranzillaCheckoutOptions,
): TranzillaCheckoutResult {
  const {
    tranzillaTerminal,
    tranzillaTerminalToken,
    tranzillaPrivateKey,
    tranzillaHandShakeEnabled,
  } = getPaymentEnv()

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

  if (tranzillaHandShakeEnabled) {
    if (!tranzillaPrivateKey) {
      throw new Error(
        'TRANZILLA_HAND_SHAKE_ENABLED=true but TRANZILLA_PRIVATE_KEY is unset — refusing to build an unsigned iframe URL under Hand Shake.',
      )
    }
    params.response_hash = signCheckoutParams({ privateKey: tranzillaPrivateKey, params })
  }

  const query = new URLSearchParams(params).toString()
  const checkoutUrl = `${TRANZILLA_DIRECT_BASE}/${terminal}/iframenew.php?${query}`

  return { checkoutUrl, terminal }
}

/**
 * Direct-charge a stored TranzilaTK token (merchant-initiated).
 *
 * Used by /api/cron/tranzilla-renewals to run the monthly recurring charge
 * against the card captured during the bootstrap iframe flow. No buyer
 * interaction required — the token was authorized for recurring charges
 * when the tokenization terminal (`fxpaguytok`) issued it.
 *
 * Endpoint: `https://direct.tranzila.com/<terminal>/iframenew.php`. Even
 * though the URL suggests iframes, Tranzilla accepts form-urlencoded POSTs
 * server-side and returns the same URL-encoded response body it would use
 * in a browser redirect — just read the body text and parse it.
 *
 * The response's `Response` field is `000` on approval, any other 3-digit
 * code on decline. `index` is the Tranzilla transaction id, mirrored into
 * our Transactions.providerTransactionId for reconciliation and dedup.
 *
 * Note: this path has not yet been reconciled against a real merchant
 * account. Shai will confirm `expdate` + whether the tokenization terminal
 * suffices without it. If prod responses are 404/500 on this URL, swap in
 * the TranzilaPG REST endpoint path once Tranzilla support provides it
 * (prior attempt at `/v1/transaction/search` returned 404 — see tranzilla.ts
 * header comment).
 */
export interface ChargeTranzillaTokenOptions {
  token: string
  sum: number
  currency: TranzillaCurrency
  expDate?: string
  description?: string
}

export interface ChargeTranzillaTokenResult {
  /** True iff Tranzilla returned Response=000. */
  approved: boolean
  /**
   * True when we did NOT get a parseable Tranzilla response — HTTP 5xx,
   * network error, HTML error page from a reverse proxy, missing `Response`
   * field in the body, etc. Callers must treat this differently from a
   * genuine decline (`approved=false, providerError=false`); mapping
   * provider outages to declines force-expires subscribers en masse.
   */
  providerError: boolean
  /** Diagnostic reason when providerError is true (http_status / parse / network). */
  providerErrorReason: string | null
  responseCode: string
  index: string | null
  confirmationCode: string | null
  raw: Record<string, string>
}

export async function chargeTranzillaToken(
  options: ChargeTranzillaTokenOptions,
): Promise<ChargeTranzillaTokenResult> {
  const { tranzillaTerminal, tranzillaTerminalToken } = getPaymentEnv()

  const terminal = tranzillaTerminalToken || tranzillaTerminal
  if (!terminal) {
    throw new Error('chargeTranzillaToken: TRANZILLA_TERMINAL(_TOKEN) env var is not set')
  }
  if (!options.token) {
    throw new Error('chargeTranzillaToken: `token` is required')
  }

  const params = new URLSearchParams({
    sum: options.sum.toFixed(2),
    currency: String(TRANZILLA_CURRENCY_CODE[options.currency]),
    cred_type: '1',
    tranmode: 'A',
    TranzilaTK: options.token,
  })
  if (options.expDate) params.set('expdate', options.expDate)
  if (options.description) params.set('pdesc', options.description)

  const url = `${TRANZILLA_DIRECT_BASE}/${terminal}/iframenew.php`

  const errorResult = (reason: string): ChargeTranzillaTokenResult => ({
    approved: false,
    providerError: true,
    providerErrorReason: reason,
    responseCode: '',
    index: null,
    confirmationCode: null,
    raw: {},
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
  } catch (err) {
    return errorResult(`network: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    return errorResult(`http_${response.status}`)
  }

  const text = await response.text()
  const parsed = Object.fromEntries(new URLSearchParams(text).entries()) as Record<string, string>

  const responseCode = parsed.Response ?? parsed.response ?? ''
  // Empty / missing Response field means we didn't get a Tranzilla answer
  // we can act on — most likely an HTML error page from a reverse proxy
  // or a terminal misconfiguration. Treat as a provider error, not a
  // decline, so the cron doesn't retry/expire the sub on provider outages.
  if (!responseCode) {
    return errorResult('missing_response_field')
  }

  return {
    approved: responseCode === '000',
    providerError: false,
    providerErrorReason: null,
    responseCode,
    index: parsed.index ?? null,
    confirmationCode: parsed.ConfirmationCode ?? null,
    raw: parsed,
  }
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
