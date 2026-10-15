/**
 * Tranzila V2 (TRAPI) API client — HMAC-SHA256-authenticated REST wrapper.
 *
 * Used by the My-Billing (STO) subscription path and (eventually) the test
 * offer's one-off charge. Not used by the hosted-iframe one-time flow, which
 * stays on the direct.tranzila.com form-POST path.
 *
 * Auth: every request carries four headers:
 *   X-tranzila-api-app-key       — the public key (per terminal)
 *   X-tranzila-api-request-time  — Unix seconds (NOT ms)
 *   X-tranzila-api-nonce         — 40-byte hex-encoded random string
 *   X-tranzila-api-access-token  — HMAC-SHA256(key=privateKey + request-time + nonce,
 *                                              message=publicKey)
 *                                  hex-encoded
 *
 * The HMAC input layout is Tranzila's quirk and the single thing most likely
 * to be wrong on first integration. The repo includes
 * `scripts/smoke-tranzila-v2-auth.ts` which hits the read-only transactions
 * query endpoint with real creds — if it returns anything other than a 401
 * / "unauthorized" shape, auth is working regardless of whether the
 * specific query returned data. Use that script as the ground truth when
 * the live endpoint disagrees with what we think we're sending.
 *
 * @fileType utility
 * @domain payments
 */

import { createHmac, randomBytes } from 'node:crypto'

import { getPaymentEnv } from './env'

const TRANZILA_V2_BASE_URL = 'https://api.tranzila.com'

export interface TranzilaV2Headers {
  'X-tranzila-api-app-key': string
  'X-tranzila-api-request-time': string
  'X-tranzila-api-nonce': string
  'X-tranzila-api-access-token': string
}

/**
 * Build the four HMAC auth headers for a V2 request. Pure function (no env
 * reads beyond what's passed in), so unit tests can drive it with fixed
 * inputs for determinism.
 */
export function buildV2AuthHeaders(args: {
  publicKey: string
  privateKey: string
  nowSeconds?: number
  nonce?: string
}): TranzilaV2Headers {
  const { publicKey, privateKey } = args
  if (!publicKey) throw new Error('buildV2AuthHeaders: publicKey required')
  if (!privateKey) throw new Error('buildV2AuthHeaders: privateKey required')

  const requestTime = String(args.nowSeconds ?? Math.floor(Date.now() / 1000))
  // 40 hex chars = 20 bytes of entropy. Tranzila's docs say "40 bytes
  // NONCE – unique random string"; across both interpretations (20 bytes
  // → 40 hex chars, or 40 bytes → 80 hex chars) 40 hex characters is the
  // commonly-accepted width in Tranzila examples. Longer nonces are
  // tolerated when auth works at all.
  const nonce = args.nonce ?? randomBytes(20).toString('hex')

  // HMAC key is the concatenation of (privateKey + request_time + nonce),
  // signing the public key. See file header for why this specific layout.
  const hmacKey = `${privateKey}${requestTime}${nonce}`
  const accessToken = createHmac('sha256', hmacKey).update(publicKey).digest('hex')

  return {
    'X-tranzila-api-app-key': publicKey,
    'X-tranzila-api-request-time': requestTime,
    'X-tranzila-api-nonce': nonce,
    'X-tranzila-api-access-token': accessToken,
  }
}

export interface TranzilaV2Response<T = Record<string, unknown>> {
  /** HTTP status code from the response. 200 means Tranzila answered; check error_code for business status. */
  httpStatus: number
  /** Tranzila's business-level status. 0 = success, non-zero = error (see message). */
  errorCode: number | null
  /** Human-readable description of the error_code. */
  message: string | null
  /** The raw JSON body, typed to T when the caller knows the shape. */
  body: T
  /** Raw response text — useful when the response isn't JSON (HTML error pages, empty bodies). */
  rawText: string
  /** Response's Content-Type header — helps distinguish HTML vs JSON responses when debugging. */
  contentType: string | null
}

export interface PostV2Options {
  /** Path under api.tranzila.com, must start with '/' (e.g. '/v1/transactions'). */
  path: string
  /** JSON body. `terminal_name` is required by every V2 endpoint — callers add it. */
  body: Record<string, unknown>
  /** Override the base URL (used by tests). */
  baseUrl?: string
  /** Fixed clock for deterministic tests. */
  nowSeconds?: number
  /** Fixed nonce for deterministic tests. */
  nonce?: string
}

/**
 * POST a JSON body to a V2 endpoint with HMAC auth. Reads the terminal
 * credentials from getPaymentEnv() — callers specify terminal_name inside
 * the body (per Tranzila's API, which supports multiple terminals under
 * one account).
 */
export async function postV2<T = Record<string, unknown>>(
  options: PostV2Options,
): Promise<TranzilaV2Response<T>> {
  const { path, body, baseUrl = TRANZILA_V2_BASE_URL, nowSeconds, nonce } = options

  const { tranzillaPublicKey, tranzillaPrivateKey } = getPaymentEnv()
  const headers = buildV2AuthHeaders({
    publicKey: tranzillaPublicKey,
    privateKey: tranzillaPrivateKey,
    nowSeconds,
    nonce,
  })

  const url = `${baseUrl}${path}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  const rawText = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {}
  } catch {
    // Non-JSON response (HTML error page from a proxy, or Tranzila returning
    // a plain text error). Leave body empty and let the caller decide what
    // the httpStatus means.
  }

  const errorCode = typeof parsed.error_code === 'number' ? parsed.error_code : null
  const message = typeof parsed.message === 'string' ? parsed.message : null

  return {
    httpStatus: response.status,
    errorCode,
    message,
    body: parsed as T,
    rawText,
    contentType: response.headers.get('content-type'),
  }
}

// ─── Convenience wrappers for the endpoints we actually use ───────────────

export interface QueryTransactionByIndexArgs {
  terminalName: string
  transactionIndex: number
}

/**
 * Read-only query — fetch a transaction by its Tranzila index. Used by the
 * smoke script to validate HMAC auth without side effects: a correctly-
 * authed request against a non-existent index returns a specific
 * "transaction_not_found" error, while an auth failure returns a 401 or a
 * generic "unauthorized" error code.
 */
export function queryTransactionByIndex(
  args: QueryTransactionByIndexArgs,
): Promise<TranzilaV2Response> {
  return postV2({
    path: '/v1/transactions',
    body: {
      terminal_name: args.terminalName,
      transaction_index: args.transactionIndex,
    },
  })
}
