/**
 * Unit tests for Tranzila Hand Shake (iframe thtk flow).
 *
 * Covers:
 *   - createTranzillaCheckout OFF (default): URL carries no thtk, is directed
 *     at the legacy or DirectNG endpoint based on TRANZILLA_USE_DIRECTNG.
 *   - createTranzillaCheckout ON: calls /v2/handshake/create to get a thtk,
 *     attaches it as the `thtk` query param, binds the handshake sum to the
 *     iframe URL's sum.
 *   - Failure modes: non-zero error_code, missing thtk → throws.
 *
 * The thtk flow replaces our earlier incorrect assumption that we needed to
 * compute an HMAC signature client-side (the `signCheckoutParams` approach).
 * Tranzila's actual protocol issues a session token server-side (via api.tranzila.com
 * with the four-header HMAC we already have) and we just attach it to the URL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetPaymentEnvCache } from '@/lib/payment/env'
import { createTranzillaCheckout } from '@/lib/payment/tranzilla'

const TEST_PRIVATE_KEY = 'priv-test-key'
const FAKE_THTK = 'w5129f9cdd2ab53675bbb675c6b59dc51df3b8ce5f'

describe('createTranzillaCheckout — Hand Shake wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let lastRequest: { url?: string; init?: RequestInit } = {}

  beforeEach(() => {
    process.env.TRANZILLA_TERMINAL = 'fxpaguy'
    process.env.TRANZILLA_TERMINAL_TOKEN = 'fxpaguytok'
    process.env.TRANZILLA_PUBLIC_KEY = 'pub-test-key'
    process.env.TRANZILLA_PRIVATE_KEY = TEST_PRIVATE_KEY
    delete process.env.TRANZILLA_HAND_SHAKE_ENABLED
    delete process.env.TRANZILLA_USE_DIRECTNG
    resetPaymentEnvCache()

    lastRequest = {}
    fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      lastRequest = { url: typeof url === 'string' ? url : String(url), init }
      return new Response(JSON.stringify({ error_code: 0, message: 'Success', thtk: FAKE_THTK }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.TRANZILLA_HAND_SHAKE_ENABLED
    delete process.env.TRANZILLA_USE_DIRECTNG
    resetPaymentEnvCache()
  })

  function callDefaults() {
    return createTranzillaCheckout({
      sum: 59,
      currency: 'ILS',
      description: 'AGuy basic',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
      notifyUrl: 'https://x/webhook',
    })
  }

  it('OFF by default — URL carries no thtk and the handshake API is not called', async () => {
    const { checkoutUrl } = await callDefaults()
    const url = new URL(checkoutUrl)
    expect(url.searchParams.has('thtk')).toBe(false)
    expect(url.searchParams.has('response_hash')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ON — POSTs /v2/handshake/create with { terminal_name, sum } and attaches thtk to URL', async () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl } = await callDefaults()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastRequest.url).toBe('https://api.tranzila.com/v2/handshake/create')
    const body = JSON.parse(String(lastRequest.init?.body))
    // Terminal picked by useTokenTerminal flag — default (false) uses the main
    // iframe terminal (fxpaguy), not the token terminal.
    expect(body).toEqual({ terminal_name: 'fxpaguy', sum: 59 })

    const url = new URL(checkoutUrl)
    expect(url.searchParams.get('thtk')).toBe(FAKE_THTK)
  })

  it('ON — iframe URL sum MUST match the sum passed to handshake (binding)', async () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl } = await createTranzillaCheckout({
      sum: 59,
      currency: 'ILS',
      description: 'd',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
      notifyUrl: 'https://x/webhook',
    })
    const body = JSON.parse(String(lastRequest.init?.body))
    expect(body.sum).toBe(59)
    const url = new URL(checkoutUrl)
    expect(url.searchParams.get('sum')).toBe('59.00')
  })

  it('ON — throws when Tranzila returns no thtk in the response', async () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    resetPaymentEnvCache()

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error_code: 0, message: 'Success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(callDefaults()).rejects.toThrow(/Hand Shake token creation failed/)
  })

  it('ON — throws when Tranzila returns a non-zero error_code', async () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    resetPaymentEnvCache()

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error_code: 20004, message: 'bad params' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(callDefaults()).rejects.toThrow(/Hand Shake token creation failed/)
  })

  it('TRANZILLA_USE_DIRECTNG=true routes to directng.tranzila.com', async () => {
    process.env.TRANZILLA_USE_DIRECTNG = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl } = await callDefaults()
    expect(checkoutUrl).toMatch(/^https:\/\/directng\.tranzila\.com\//)
    expect(checkoutUrl).not.toMatch(/^https:\/\/direct\.tranzila\.com/)
  })

  it('TRANZILLA_USE_DIRECTNG unset (default) uses legacy direct.tranzila.com', async () => {
    delete process.env.TRANZILLA_USE_DIRECTNG
    resetPaymentEnvCache()

    const { checkoutUrl } = await callDefaults()
    expect(checkoutUrl).toMatch(/^https:\/\/direct\.tranzila\.com\//)
    expect(checkoutUrl).not.toMatch(/directng/)
  })

  it('ON + DirectNG — handshake fires, thtk lands on the directng URL', async () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    process.env.TRANZILLA_USE_DIRECTNG = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl } = await callDefaults()
    expect(checkoutUrl).toMatch(/^https:\/\/directng\.tranzila\.com\//)
    const url = new URL(checkoutUrl)
    expect(url.searchParams.get('thtk')).toBe(FAKE_THTK)
  })
})
