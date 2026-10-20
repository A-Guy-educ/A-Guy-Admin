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

// ─── My-Billing (STO) — create a standing order ──────────────────────────

export type TranzilaChargeFrequency = 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'

export interface TranzilaStoClient {
  /** Buyer full name — surfaced on Tranzila's receipts + My-Billing UI. */
  name: string
  /** Buyer email — Tranzila uses this for the "update your card" dunning flow. */
  email: string
  /** Buyer phone (optional in Tranzila's docs; some flows require it). */
  phone?: string
}

export interface TranzilaStoItem {
  itemName: string
  unitPriceIls: number
  quantity?: number
}

export interface CreateStandingOrderArgs {
  terminalName: string
  /** Reusable TranzilaTK token issued by the tokenization terminal's iframe. */
  cardToken: string
  /** Card expiry month 1-12. Tranzila's STO schema wants an integer here
   * (unlike currency_code which must be a string). */
  cardExpireMonth: number
  /** Card expiry year 4-digit (e.g. 2030). Tranzila's STO schema enforces
   * `minimum: 2020`, so pass the full year — NOT the 2-digit form Tranzila's
   * iframe uses on the inbound notify_url. */
  cardExpireYear: number
  /** Total number of charges Tranzila will run on this STO. Finite — we pick a long horizon. */
  stoPaymentsNumber: number
  chargeFrequency: TranzilaChargeFrequency
  /** Date of the FIRST STO charge in `YYYY-MM-DD` format (Tranzila's expected shape). */
  firstChargeDate: string
  /** Day-of-month for subsequent charges (1-31). */
  chargeDayOfMonth: number
  client: TranzilaStoClient
  items: TranzilaStoItem[]
  /** ISO 4217 alpha code. Defaults to 'ILS'. Tranzila's STO validator accepts
   * only 'ILS' | 'USD' | 'EUR' (not the numeric 1/2/978 the iframe accepts). */
  currencyCode?: 'ILS' | 'USD' | 'EUR'
  /** Optional VAT percent — defaults to 0 (receipts come from Green Invoice). */
  vatPercent?: number
}

export interface CreateStandingOrderResult {
  stoId: string | null
  errorCode: number | null
  message: string | null
  raw: TranzilaV2Response
}

/**
 * Format a Date (or Date-ish string) as `YYYY-MM-DD` in UTC.
 *
 * Tranzila's docs show first_charge_date as a plain calendar date without
 * a timezone qualifier. We use UTC so the choice of charge-day isn't
 * sensitive to the server's locale (Vercel runs UTC; local dev may not).
 */
export function formatTranzilaDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Create a My-Billing standing order. On success, Tranzila schedules all
 * remaining recurring charges against the stored token — our side can
 * discard the local token copy at that point.
 *
 * Endpoint path: the Tranzila docs show deprecation notices on
 * `/v1/sto/create` pointing at a "V2 API for standing orders". The V2
 * STO endpoints live under `/v2/sto/*` per the My-Billing docs. If the
 * live request 404s against /v2/sto/create, flip to /v1/sto/create or
 * ask Tranzila support for the final path.
 */
export async function createStandingOrder(
  args: CreateStandingOrderArgs,
): Promise<CreateStandingOrderResult> {
  if (args.stoPaymentsNumber <= 0) {
    throw new Error('createStandingOrder: stoPaymentsNumber must be positive')
  }
  if (!args.cardToken) {
    throw new Error('createStandingOrder: cardToken required')
  }
  if (args.chargeDayOfMonth < 1 || args.chargeDayOfMonth > 31) {
    throw new Error(
      `createStandingOrder: chargeDayOfMonth must be 1-31 (got ${args.chargeDayOfMonth})`,
    )
  }

  // Tranzila's /v2/sto/create validator expects `currency_code` as an ISO 4217
  // ALPHA code string: "ILS" | "USD" | "EUR". The hosted-iframe API uses the
  // numeric ISO 4217 code (1/2/978) — two different Tranzila APIs, two different
  // conventions. Live request against admin.dev first returned error_code 20004
  // "expected string, used integer", then after stringifying returned 20004
  // again with `mismatch_info: [{keyword: "enum", expected: ["ILS","USD","EUR"], used: "1"}]`.
  // Alpha code required at both top-level and inside each item.
  const currencyCode = args.currencyCode ?? 'ILS'
  const body = {
    terminal_name: args.terminalName,
    sto_payments_number: args.stoPaymentsNumber,
    charge_frequency: args.chargeFrequency,
    first_charge_date: args.firstChargeDate,
    charge_dom: args.chargeDayOfMonth,
    currency_code: currencyCode,
    vat_percent: args.vatPercent ?? 0,
    client: {
      name: args.client.name,
      email: args.client.email,
      ...(args.client.phone ? { phone: args.client.phone } : {}),
    },
    // Each item's product name field is `name`, NOT `item_name`. Tranzila's
    // v2 STO validator reports `{keyword: "required", missing: "name",
    // data_path: ["items", 0]}` when given item_name. The error payload also
    // echoes the fields Tranzila defaults (internal_id: null, code: null,
    // type: "I", unit_type: 1, index_link: "N") — leaving those unset works.
    items: args.items.map((item) => ({
      name: item.itemName,
      unit_price: item.unitPriceIls,
      quantity: item.quantity ?? 1,
      currency_code: currencyCode,
      vat_percent: args.vatPercent ?? 0,
    })),
    // Tranzila's STO validator requires card expiry on the card object even
    // when a stored token is used. `expire_month` + `expire_year` are both
    // required strings. The webhook captures these from the first-charge
    // notify_url POST (fields `expmonth` and `expyear`) and passes them in.
    card: {
      token: args.cardToken,
      expire_month: args.cardExpireMonth,
      expire_year: args.cardExpireYear,
    },
    // Per-STO notification URL is NOT a createstov2 field. Tranzila rejects
    // `notification_url` as additionalProperties (error_code 20004) and the
    // documented schema has zero callback fields. Config is terminal-scoped:
    // set the My-Billing notify URL at my.tranzila.com → Settings → Terminal →
    // My-Billing on terminal `fxpaguytok`. Once set, every STO run POSTs to
    // that URL and the webhook's sto_id correlation branch picks it up.
  }

  const raw = await postV2({
    path: '/v2/sto/create',
    body,
  })

  // Tranzila's STO response shape per the docs: {error_code, message, sto_id}.
  // Pick stoId from either field name since API versions have been inconsistent
  // elsewhere in their surface.
  const stoIdRaw =
    (raw.body as Record<string, unknown>).sto_id ?? (raw.body as Record<string, unknown>).stoId
  const stoId =
    typeof stoIdRaw === 'string' || typeof stoIdRaw === 'number' ? String(stoIdRaw) : null

  return {
    stoId,
    errorCode: raw.errorCode,
    message: raw.message,
    raw,
  }
}

// ─── My-Billing (STO) — cancel / inactivate a standing order ─────────────

export interface CancelStandingOrderArgs {
  terminalName: string
  stoId: string
}

/**
 * Flip a standing order to `inactive`. Three call sites:
 *   1. User-initiated cancellation (PATCH /api/subscriptions/:id/cancel).
 *   2. Admin-UI cancel via the Subscriptions.beforeChange hook.
 *   3. Rollback of an orphaned STO when our DB write after a successful
 *      createstov2 fails — without this cleanup the user would be billed
 *      both by Tranzila's STO AND by our own fallback cron.
 *
 * Shape (verified live 2026-10-19 via scripts/probe-tranzila-sto-update.ts):
 *   POST /v2/sto/update
 *   { terminal_name: string, sto_id: integer, sto_status: 'active' | 'inactive' }
 *
 * CRITICAL: Tranzila's validator rejects `sto_id` as a string with
 * error_code 20004 "Json does not match validation schema" (type expected
 * integer, used string). We store stoId as text in Mongo but MUST convert
 * to a number here or every cancel 20004s. Parsed + guarded locally so
 * callers can keep passing the DB-shape string.
 *
 * Idempotent server-side — flipping an already-inactive STO is a no-op.
 */
export interface SwapStoItemsArgs {
  terminalName: string
  stoId: string
  /** Item name shown on Tranzila's dashboard — becomes the "product name" column. */
  itemName: string
  /** New per-charge price in ILS major units (e.g. 119 = ₪119.00). */
  unitPriceIls: number
}

/**
 * Replace an STO's items array in place — Tranzila's documented "items are
 * deleted and replaced" behavior for /v2/sto/update. Used by the tier-change
 * endpoint to swap the recurring charge amount without needing a card token
 * (we no longer have one post-handoff). Keeps the same sto_id and card.
 *
 * CRITICAL schema quirk (verified live via scripts/probe-tranzila-sto-items-swap.ts):
 * the items schema for /v2/sto/update accepts ONLY `name` and `unit_price`.
 * Any other field (quantity, currency_code, vat_percent, type, etc.) trips
 * additionalProperties — error_code 20004. The create endpoint accepts a
 * much wider shape, so don't copy the createStandingOrder items shape here.
 */
export async function swapStandingOrderItems(args: SwapStoItemsArgs): Promise<TranzilaV2Response> {
  const stoIdNum = Number(args.stoId)
  if (!Number.isSafeInteger(stoIdNum) || stoIdNum <= 0) {
    throw new Error(
      `swapStandingOrderItems: stoId must be a positive integer string, got "${args.stoId}"`,
    )
  }
  if (!(args.unitPriceIls > 0)) {
    throw new Error(
      `swapStandingOrderItems: unitPriceIls must be positive, got ${args.unitPriceIls}`,
    )
  }
  return postV2({
    path: '/v2/sto/update',
    body: {
      terminal_name: args.terminalName,
      sto_id: stoIdNum,
      items: [{ name: args.itemName, unit_price: args.unitPriceIls }],
    },
  })
}

export async function cancelStandingOrder(
  args: CancelStandingOrderArgs,
): Promise<TranzilaV2Response> {
  const stoIdNum = Number(args.stoId)
  if (!Number.isSafeInteger(stoIdNum) || stoIdNum <= 0) {
    throw new Error(
      `cancelStandingOrder: stoId must be a positive integer string, got "${args.stoId}"`,
    )
  }
  return postV2({
    path: '/v2/sto/update',
    body: {
      terminal_name: args.terminalName,
      sto_id: stoIdNum,
      sto_status: 'inactive',
    },
  })
}
