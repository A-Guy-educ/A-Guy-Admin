/**
 * Unit tests for createStandingOrder + formatTranzilaDate.
 *
 * No network: the test replaces `global.fetch` with a vi.fn so we can
 * assert on the body shape, HMAC headers presence, and endpoint path
 * without hitting Tranzila. Payload-shape regressions are caught here;
 * live validation lives in the forthcoming smoke script.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStandingOrder, formatTranzilaDate } from '@/lib/payment/tranzila-v2-client'
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
      currency_code: 1,
      vat_percent: 0,
      client: {
        name: 'Test User',
        email: 'test@example.com',
      },
      items: [
        {
          item_name: 'AGuy Subscription — basic',
          unit_price: 59,
          quantity: 1,
          currency_code: 1,
          vat_percent: 0,
        },
      ],
      card: { token: 'TK-abc123' },
    })
  })

  it('includes phone on the client object when provided', async () => {
    await createStandingOrder({
      terminalName: 'fxpaguytok',
      cardToken: 'TK-abc123',
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
