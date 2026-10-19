/**
 * Unit tests for createStandingOrder + formatTranzilaDate.
 *
 * No network: the test replaces `global.fetch` with a vi.fn so we can
 * assert on the body shape, HMAC headers presence, and endpoint path
 * without hitting Tranzila. Payload-shape regressions are caught here;
 * live validation lives in the forthcoming smoke script.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelStandingOrder,
  createStandingOrder,
  formatTranzilaDate,
} from '@/lib/payment/tranzila-v2-client'
import { resetPaymentEnvCache } from '@/lib/payment/env'

describe('formatTranzilaDate', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2026, 10, 15, 12, 34, 56))
    expect(formatTranzilaDate(d)).toBe('2026-11-15')
  })

  it('pads single-digit month and day', () => {
    const d = new Date(Date.UTC(2026, 0, 3, 0, 0, 0))
    expect(formatTranzilaDate(d)).toBe('2026-01-03')
  })

  it('uses UTC, not local time', () => {
    // 2026-11-15 23:00 UTC-08:00 is 2026-11-16 07:00 UTC. Should return
    // the UTC date (16), not the local date (15), so the server timezone
    // doesn't shift the chosen charge-day.
    const d = new Date('2026-11-16T07:00:00.000Z')
    expect(formatTranzilaDate(d)).toBe('2026-11-16')
  })
})

describe('createStandingOrder', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let capturedRequest: { url?: string; init?: RequestInit } = {}

  beforeEach(() => {
    process.env.TRANZILLA_TERMINAL = 'fxpaguy'
    process.env.TRANZILLA_TERMINAL_TOKEN = 'fxpaguytok'
    process.env.TRANZILLA_PUBLIC_KEY = 'pub-test-key'
    process.env.TRANZILLA_PRIVATE_KEY = 'priv-test-key'
    process.env.TRANZILLA_SANDBOX = 'true'
    resetPaymentEnvCache()

    capturedRequest = {}
    fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequest = { url: typeof url === 'string' ? url : String(url), init }
      return new Response(JSON.stringify({ error_code: 0, message: 'ok', sto_id: '189976' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetPaymentEnvCache()
  })

  function callDefaults() {
    return createStandingOrder({
      terminalName: 'fxpaguytok',
      cardToken: 'TK-abc123',
      cardExpireMonth: 12,
      cardExpireYear: 2030,
      stoPaymentsNumber: 119,
      chargeFrequency: 'monthly',
      firstChargeDate: '2026-11-15',
      chargeDayOfMonth: 15,
      client: { name: 'Test User', email: 'test@example.com' },
      items: [{ itemName: 'AGuy Subscription — basic', unitPriceIls: 59 }],
    })
  }

  it('POSTs to /v2/sto/create with the four HMAC auth headers', async () => {
    await callDefaults()
    expect(capturedRequest.url).toBe('https://api.tranzila.com/v2/sto/create')
    expect(capturedRequest.init?.method).toBe('POST')
    const headers = capturedRequest.init?.headers as Record<string, string>
    expect(headers['X-tranzila-api-app-key']).toBe('pub-test-key')
    expect(headers['X-tranzila-api-request-time']).toMatch(/^\d{10}$/)
    expect(headers['X-tranzila-api-nonce']).toMatch(/^[0-9a-f]{40}$/)
    expect(headers['X-tranzila-api-access-token']).toMatch(/^[0-9a-f]{64}$/)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('serializes the documented payload shape', async () => {
    await callDefaults()
    const body = JSON.parse(String(capturedRequest.init?.body))
    expect(body).toEqual({
      terminal_name: 'fxpaguytok',
      sto_payments_number: 119,
      charge_frequency: 'monthly',
      first_charge_date: '2026-11-15',
      charge_dom: 15,
      // currency_code is serialized as an ISO 4217 ALPHA code (ILS/USD/EUR) —
      // Tranzila's /v2/sto/create validator rejects both integers (20004 "expected
      // string, used integer") AND numeric strings (20004 "expected enum of ILS/USD/EUR").
      currency_code: 'ILS',
      vat_percent: 0,
      client: {
        name: 'Test User',
        email: 'test@example.com',
      },
      items: [
        {
          name: 'AGuy Subscription — basic',
          unit_price: 59,
          quantity: 1,
          currency_code: 'ILS',
          vat_percent: 0,
        },
      ],
      card: { token: 'TK-abc123', expire_month: 12, expire_year: 2030 },
    })
  })

  it('never sends notification_url — Tranzila rejects it with error_code 20004 (additionalProperties)', async () => {
    // Per-STO notify URL is NOT a createstov2 field. The My-Billing notify
    // URL is configured at the terminal level in the Tranzila dashboard, not
    // per-STO. Attempting to pass it in the body trips Tranzila's validator:
    // regression test to prevent re-introducing the field.
    await callDefaults()
    const body = JSON.parse(String(capturedRequest.init?.body))
    expect(body).not.toHaveProperty('notification_url')
    expect(body).not.toHaveProperty('notify_url')
    expect(body).not.toHaveProperty('callback_url')
  })

  it('includes phone on the client object when provided', async () => {
    await createStandingOrder({
      terminalName: 'fxpaguytok',
      cardToken: 'TK-abc123',
      cardExpireMonth: 12,
      cardExpireYear: 2030,
      stoPaymentsNumber: 119,
      chargeFrequency: 'monthly',
      firstChargeDate: '2026-11-15',
      chargeDayOfMonth: 15,
      client: { name: 'Test User', email: 'test@example.com', phone: '+972501234567' },
      items: [{ itemName: 'basic', unitPriceIls: 59 }],
    })
    const body = JSON.parse(String(capturedRequest.init?.body))
    expect(body.client.phone).toBe('+972501234567')
  })

  it('returns stoId from the response', async () => {
    const result = await callDefaults()
    expect(result.stoId).toBe('189976')
    expect(result.errorCode).toBe(0)
    expect(result.message).toBe('ok')
  })

  it('returns stoId=null when response omits sto_id', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error_code: 20099, message: 'invalid terminal' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await callDefaults()
    expect(result.stoId).toBeNull()
    expect(result.errorCode).toBe(20099)
    expect(result.message).toBe('invalid terminal')
  })

  it('throws when stoPaymentsNumber is non-positive', async () => {
    await expect(
      createStandingOrder({
        terminalName: 'fxpaguytok',
        cardToken: 'TK',
        cardExpireMonth: 12,
        cardExpireYear: 2030,
        stoPaymentsNumber: 0,
        chargeFrequency: 'monthly',
        firstChargeDate: '2026-11-15',
        chargeDayOfMonth: 15,
        client: { name: 'X', email: 'x@y.z' },
        items: [{ itemName: 'x', unitPriceIls: 1 }],
      }),
    ).rejects.toThrow(/stoPaymentsNumber/)
  })

  it('throws when cardToken is empty', async () => {
    await expect(
      createStandingOrder({
        terminalName: 'fxpaguytok',
        cardToken: '',
        cardExpireMonth: 12,
        cardExpireYear: 2030,
        stoPaymentsNumber: 119,
        chargeFrequency: 'monthly',
        firstChargeDate: '2026-11-15',
        chargeDayOfMonth: 15,
        client: { name: 'X', email: 'x@y.z' },
        items: [{ itemName: 'x', unitPriceIls: 1 }],
      }),
    ).rejects.toThrow(/cardToken/)
  })

  it('throws when chargeDayOfMonth is out of range', async () => {
    await expect(
      createStandingOrder({
        terminalName: 'fxpaguytok',
        cardToken: 'TK',
        cardExpireMonth: 12,
        cardExpireYear: 2030,
        stoPaymentsNumber: 119,
        chargeFrequency: 'monthly',
        firstChargeDate: '2026-11-15',
        chargeDayOfMonth: 32,
        client: { name: 'X', email: 'x@y.z' },
        items: [{ itemName: 'x', unitPriceIls: 1 }],
      }),
    ).rejects.toThrow(/chargeDayOfMonth/)
  })
})

describe('cancelStandingOrder', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let capturedRequest: { url?: string; init?: RequestInit } = {}

  beforeEach(() => {
    process.env.TRANZILLA_TERMINAL = 'fxpaguy'
    process.env.TRANZILLA_TERMINAL_TOKEN = 'fxpaguytok'
    process.env.TRANZILLA_PUBLIC_KEY = 'pub-test-key'
    process.env.TRANZILLA_PRIVATE_KEY = 'priv-test-key'
    process.env.TRANZILLA_SANDBOX = 'true'
    resetPaymentEnvCache()

    capturedRequest = {}
    fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedRequest = { url: typeof url === 'string' ? url : String(url), init }
      return new Response(JSON.stringify({ error_code: 0, message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetPaymentEnvCache()
  })

  it('POSTs to /v2/sto/update with sto_status=inactive and the four HMAC headers', async () => {
    await cancelStandingOrder({ terminalName: 'fxpaguytok', stoId: '189976' })
    expect(capturedRequest.url).toBe('https://api.tranzila.com/v2/sto/update')
    expect(capturedRequest.init?.method).toBe('POST')
    const body = JSON.parse(String(capturedRequest.init?.body))
    // sto_id MUST be a number — Tranzila's validator rejects it as a string
    // with error_code 20004 (type: expected integer, used string). Proven
    // live 2026-10-19 via scripts/probe-tranzila-sto-update.ts.
    expect(body).toEqual({
      terminal_name: 'fxpaguytok',
      sto_id: 189976,
      sto_status: 'inactive',
    })
    expect(typeof body.sto_id).toBe('number')
    const headers = capturedRequest.init?.headers as Record<string, string>
    expect(headers['X-tranzila-api-app-key']).toBe('pub-test-key')
    expect(headers['X-tranzila-api-access-token']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('throws when stoId is not a parseable positive integer', async () => {
    await expect(
      cancelStandingOrder({ terminalName: 'fxpaguytok', stoId: 'not-a-number' }),
    ).rejects.toThrow(/positive integer/)
    await expect(cancelStandingOrder({ terminalName: 'fxpaguytok', stoId: '-5' })).rejects.toThrow(
      /positive integer/,
    )
    await expect(cancelStandingOrder({ terminalName: 'fxpaguytok', stoId: '' })).rejects.toThrow(
      /positive integer/,
    )
    // The webhook's CAS claim sentinel must NOT reach this function —
    // callers are expected to short-circuit on it (see user-cancel
    // endpoint and admin-cancel hook). Verify the throw as a backstop.
    await expect(
      cancelStandingOrder({
        terminalName: 'fxpaguytok',
        stoId: 'pending-handoff:689a1b2c3d4e5f6a7b8c9d0e',
      }),
    ).rejects.toThrow(/positive integer/)
  })
})
