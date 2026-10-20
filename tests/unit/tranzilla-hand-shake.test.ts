/**
 * Unit tests for Tranzila Hand Shake (outgoing iframe signing).
 *
 * Covers:
 *   - signCheckoutParams: deterministic HMAC-SHA256 over the pipe-joined
 *     signed-field values.
 *   - createTranzillaCheckout: Hand Shake OFF (default) → URL contains no
 *     response_hash; Hand Shake ON → URL carries a hex HMAC that matches
 *     signCheckoutParams's output for the same fields.
 *
 * The HMAC input layout (field list + delimiter) is NOT YET verified against
 * Tranzila's official spec — these tests pin the current implementation so
 * any accidental drift gets caught, but the live-wire correctness check still
 * belongs in a Tranzila smoke once Hand Shake is enabled on a test terminal.
 */

import { createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetPaymentEnvCache } from '@/lib/payment/env'
import {
  createTranzillaCheckout,
  signCheckoutParams,
  TRANZILLA_HAND_SHAKE_SIGNED_FIELDS,
} from '@/lib/payment/tranzilla'

const TEST_PRIVATE_KEY = 'priv-test-key'

function expectedHash(params: Record<string, string>): string {
  const payload = TRANZILLA_HAND_SHAKE_SIGNED_FIELDS.map((f) => params[f] ?? '').join('|')
  return createHmac('sha256', TEST_PRIVATE_KEY).update(payload).digest('hex')
}

describe('signCheckoutParams', () => {
  it('HMAC-SHA256 over the signed-field values joined by |', () => {
    const params = {
      sum: '1.00',
      currency: '1',
      cred_type: '1',
      tranmode: 'A',
      pdesc: 'ignored by the signature',
    }
    const got = signCheckoutParams({ privateKey: TEST_PRIVATE_KEY, params })
    expect(got).toBe(expectedHash(params))
    expect(got).toMatch(/^[0-9a-f]{64}$/)
  })

  it('empty-string placeholder when a signed field is missing', () => {
    const params = { sum: '1.00', currency: '1' } // cred_type and tranmode missing
    const got = signCheckoutParams({ privateKey: TEST_PRIVATE_KEY, params })
    expect(got).toBe(expectedHash(params))
    // The missing fields produce payload "1.00|1||" — assert the result
    // changes when they're explicitly empty-string vs. undefined, so a
    // caller can't accidentally change the signed payload by omitting fields.
    const explicitEmpty = signCheckoutParams({
      privateKey: TEST_PRIVATE_KEY,
      params: { sum: '1.00', currency: '1', cred_type: '', tranmode: '' },
    })
    expect(got).toBe(explicitEmpty)
  })

  it('a different sum produces a different hash — the price is covered', () => {
    const base = { sum: '1.00', currency: '1', cred_type: '1', tranmode: 'A' }
    const tampered = { ...base, sum: '0.01' }
    const h1 = signCheckoutParams({ privateKey: TEST_PRIVATE_KEY, params: base })
    const h2 = signCheckoutParams({ privateKey: TEST_PRIVATE_KEY, params: tampered })
    expect(h1).not.toBe(h2)
  })

  it('throws when privateKey is empty', () => {
    expect(() => signCheckoutParams({ privateKey: '', params: {} })).toThrow(/privateKey/)
  })

  it('accepts a custom signed-fields list (ordering matters)', () => {
    const params = { sum: '1.00', currency: '1', cred_type: '1', tranmode: 'A' }
    const h1 = signCheckoutParams({
      privateKey: TEST_PRIVATE_KEY,
      params,
      signedFields: ['sum', 'currency'],
    })
    const h2 = signCheckoutParams({
      privateKey: TEST_PRIVATE_KEY,
      params,
      signedFields: ['currency', 'sum'],
    })
    expect(h1).not.toBe(h2)
    expect(h1).toBe(createHmac('sha256', TEST_PRIVATE_KEY).update('1.00|1').digest('hex'))
  })
})

describe('createTranzillaCheckout — Hand Shake wiring', () => {
  beforeEach(() => {
    process.env.TRANZILLA_TERMINAL = 'fxpaguy'
    process.env.TRANZILLA_TERMINAL_TOKEN = 'fxpaguytok'
    process.env.TRANZILLA_PUBLIC_KEY = 'pub-test-key'
    process.env.TRANZILLA_PRIVATE_KEY = TEST_PRIVATE_KEY
    delete process.env.TRANZILLA_HAND_SHAKE_ENABLED
    resetPaymentEnvCache()
  })

  afterEach(() => {
    delete process.env.TRANZILLA_HAND_SHAKE_ENABLED
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

  it('OFF by default — URL carries no response_hash', () => {
    const { checkoutUrl } = callDefaults()
    const url = new URL(checkoutUrl)
    expect(url.searchParams.has('response_hash')).toBe(false)
  })

  it('ON — URL carries a response_hash matching signCheckoutParams', () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl } = callDefaults()
    const url = new URL(checkoutUrl)
    const hash = url.searchParams.get('response_hash')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)

    const expected = signCheckoutParams({
      privateKey: TEST_PRIVATE_KEY,
      params: {
        sum: '59.00',
        currency: '1',
        cred_type: '1',
        tranmode: 'A',
      },
    })
    expect(hash).toBe(expected)
  })

  it('ON without a private key — refuses to build an unsigned URL', () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    delete process.env.TRANZILLA_PRIVATE_KEY
    resetPaymentEnvCache()

    expect(() => callDefaults()).toThrow(/TRANZILLA_PRIVATE_KEY/)
  })

  it('TRANZILLA_USE_DIRECTNG=true routes to directng.tranzila.com', () => {
    process.env.TRANZILLA_USE_DIRECTNG = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl } = callDefaults()
    expect(checkoutUrl).toMatch(/^https:\/\/directng\.tranzila\.com\//)
    expect(checkoutUrl).not.toMatch(/^https:\/\/direct\.tranzila\.com/)
  })

  it('TRANZILLA_USE_DIRECTNG unset (default) uses the legacy direct.tranzila.com', () => {
    delete process.env.TRANZILLA_USE_DIRECTNG
    resetPaymentEnvCache()

    const { checkoutUrl } = callDefaults()
    expect(checkoutUrl).toMatch(/^https:\/\/direct\.tranzila\.com\//)
    expect(checkoutUrl).not.toMatch(/directng/)
  })

  it('ON — swapping the amount changes the hash (regression against unsigned-field leaks)', () => {
    process.env.TRANZILLA_HAND_SHAKE_ENABLED = 'true'
    resetPaymentEnvCache()

    const { checkoutUrl: urlCheap } = createTranzillaCheckout({
      sum: 1,
      currency: 'ILS',
      description: 'd',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
      notifyUrl: 'https://x/webhook',
    })
    const { checkoutUrl: urlExpensive } = createTranzillaCheckout({
      sum: 999,
      currency: 'ILS',
      description: 'd',
      successUrl: 'https://x/ok',
      cancelUrl: 'https://x/no',
      notifyUrl: 'https://x/webhook',
    })
    const h1 = new URL(urlCheap).searchParams.get('response_hash')
    const h2 = new URL(urlExpensive).searchParams.get('response_hash')
    expect(h1).not.toBe(h2)
  })
})
