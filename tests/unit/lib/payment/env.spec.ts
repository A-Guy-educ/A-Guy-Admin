/**
 * Unit Tests for Payment Environment Helper
 *
 * Tests the provider-aware getPaymentEnv() helper. Either Stripe or PayPal
 * may be fully configured (or both); a half-configured provider throws so
 * the first webhook doesn't silently 500 in production.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { getPaymentEnv, resetPaymentEnvCache } from '@/lib/payment/env'

function clearAllPaymentEnv() {
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_PUBLISHABLE_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_CURRENCY
  delete process.env.PAYPAL_CLIENT_ID
  delete process.env.PAYPAL_CLIENT_SECRET
  delete process.env.PAYPAL_WEBHOOK_ID
  delete process.env.PAYPAL_SANDBOX
}

describe('Payment Environment Helper', () => {
  beforeEach(() => {
    vi.resetModules()
    resetPaymentEnvCache()
    clearAllPaymentEnv()
  })

  afterEach(() => {
    resetPaymentEnvCache()
    clearAllPaymentEnv()
    vi.restoreAllMocks()
  })

  describe('Full configuration — both providers', () => {
    it('returns all payment env vars when both providers are set', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_xxx'
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'
      process.env.STRIPE_CURRENCY = 'ILS'
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_CLIENT_SECRET = 'client_secret_xxx'
      process.env.PAYPAL_WEBHOOK_ID = 'webhook_id_xxx'
      process.env.PAYPAL_SANDBOX = 'true'

      const env = getPaymentEnv()

      expect(env.stripeSecretKey).toBe('sk_test_xxx')
      expect(env.stripeWebhookSecret).toBe('whsec_xxx')
      expect(env.paypalClientId).toBe('client_id_xxx')
      expect(env.paypalClientSecret).toBe('client_secret_xxx')
      expect(env.paypalWebhookId).toBe('webhook_id_xxx')
      expect(env.paypalSandbox).toBe(true)
    })
  })

  describe('PayPal-only configuration', () => {
    it('succeeds when only PayPal vars are set', () => {
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_CLIENT_SECRET = 'client_secret_xxx'
      process.env.PAYPAL_WEBHOOK_ID = 'webhook_id_xxx'

      const env = getPaymentEnv()

      expect(env.paypalClientId).toBe('client_id_xxx')
      expect(env.stripeSecretKey).toBe('')
      expect(env.stripeWebhookSecret).toBe('')
    })

    it('defaults paypalSandbox to true when PAYPAL_SANDBOX not set', () => {
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_CLIENT_SECRET = 'client_secret_xxx'
      process.env.PAYPAL_WEBHOOK_ID = 'webhook_id_xxx'

      expect(getPaymentEnv().paypalSandbox).toBe(true)
    })

    it('throws "PayPal is partially configured" when PAYPAL_CLIENT_SECRET is missing', () => {
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_WEBHOOK_ID = 'webhook_id_xxx'

      expect(() => getPaymentEnv()).toThrow(/PayPal is partially configured.*PAYPAL_CLIENT_SECRET/)
    })

    it('throws "PayPal is partially configured" when PAYPAL_WEBHOOK_ID is missing', () => {
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_CLIENT_SECRET = 'client_secret_xxx'

      expect(() => getPaymentEnv()).toThrow(/PayPal is partially configured.*PAYPAL_WEBHOOK_ID/)
    })
  })

  describe('Stripe-only configuration', () => {
    it('succeeds when only Stripe vars are set', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'

      const env = getPaymentEnv()

      expect(env.stripeSecretKey).toBe('sk_test_xxx')
      expect(env.stripeWebhookSecret).toBe('whsec_xxx')
      expect(env.paypalClientId).toBe('')
      expect(env.paypalWebhookId).toBe('')
    })

    it('defaults STRIPE_CURRENCY to ILS when not set', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'

      expect(getPaymentEnv().stripeCurrency).toBe('ILS')
    })

    it('throws "Stripe is partially configured" when STRIPE_WEBHOOK_SECRET is missing', () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'

      expect(() => getPaymentEnv()).toThrow(/Stripe is partially configured.*STRIPE_WEBHOOK_SECRET/)
    })

    it('throws "Stripe is partially configured" when STRIPE_SECRET_KEY is missing', () => {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'

      expect(() => getPaymentEnv()).toThrow(/Stripe is partially configured.*STRIPE_SECRET_KEY/)
    })
  })

  describe('No provider configured', () => {
    it('throws when neither Stripe nor PayPal vars are set', () => {
      expect(() => getPaymentEnv()).toThrow(/No payment provider configured/)
    })

    it('the error mentions both providers so admins know what to set', () => {
      let err: Error | null = null
      try {
        getPaymentEnv()
      } catch (e) {
        err = e as Error
      }
      expect(err?.message).toMatch(/Stripe/)
      expect(err?.message).toMatch(/PayPal/)
    })
  })

  describe('Caching', () => {
    it('returns the same object on subsequent calls', () => {
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_CLIENT_SECRET = 'client_secret_xxx'
      process.env.PAYPAL_WEBHOOK_ID = 'webhook_id_xxx'

      const env1 = getPaymentEnv()
      const env2 = getPaymentEnv()
      expect(env1).toBe(env2)
    })

    it('resetPaymentEnvCache forces a re-read', () => {
      process.env.PAYPAL_CLIENT_ID = 'client_id_xxx'
      process.env.PAYPAL_CLIENT_SECRET = 'client_secret_xxx'
      process.env.PAYPAL_WEBHOOK_ID = 'webhook_id_xxx'

      const env1 = getPaymentEnv()
      expect(env1.paypalClientId).toBe('client_id_xxx')

      process.env.PAYPAL_CLIENT_ID = 'client_id_yyy'

      // Cached
      expect(getPaymentEnv().paypalClientId).toBe('client_id_xxx')

      // Re-read
      resetPaymentEnvCache()
      expect(getPaymentEnv().paypalClientId).toBe('client_id_yyy')
    })
  })
})
