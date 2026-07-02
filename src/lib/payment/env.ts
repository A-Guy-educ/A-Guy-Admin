/**
 * Payment Environment Variables Helper
 *
 * @fileType utility
 * @domain payment
 * @pattern env-vault
 * @ai-summary Validates and exposes payment provider environment variables.
 *
 * Provider-aware: only the providers you've actually configured are required
 * to be complete. Admin can ship with PayPal-only or Stripe-only env vars;
 * the unconfigured provider's secrets stay empty strings and that provider's
 * webhook URL just shouldn't be wired in the provider dashboard.
 *
 * Validation rules:
 * - At least one provider (Stripe OR PayPal) must be fully configured.
 * - A provider counts as "touched" if any of its required secrets is set;
 *   once touched, the full required set must be complete (no half-configured
 *   provider — that would silently 500 on the first webhook delivery).
 */

export interface PaymentEnv {
  stripeSecretKey: string
  stripePublishableKey: string
  stripeWebhookSecret: string
  stripeCurrency: string
  paypalClientId: string
  paypalClientSecret: string
  paypalWebhookId: string
  paypalSandbox: boolean
}

const STRIPE_REQUIRED = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const
const PAYPAL_REQUIRED = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] as const

let validatedEnv: PaymentEnv | null = null

function anySet(names: readonly string[]): boolean {
  return names.some((n) => !!process.env[n])
}

function missingFrom(names: readonly string[]): string[] {
  return names.filter((n) => !process.env[n])
}

/**
 * Get and validate all payment environment variables.
 * Throws if a partially-configured provider is detected, or if neither
 * provider is configured at all. Caches result after first call.
 */
export function getPaymentEnv(): PaymentEnv {
  if (validatedEnv) {
    return validatedEnv
  }

  const stripeTouched = anySet(STRIPE_REQUIRED)
  const paypalTouched = anySet(PAYPAL_REQUIRED)

  if (!stripeTouched && !paypalTouched) {
    throw new Error(
      'No payment provider configured. Set either the Stripe (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) or PayPal (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID) environment variables, or both.',
    )
  }

  if (stripeTouched) {
    const missing = missingFrom(STRIPE_REQUIRED)
    if (missing.length > 0) {
      throw new Error(
        `Stripe is partially configured — missing: ${missing.join(', ')}. Set the full set or clear all Stripe env vars to disable Stripe.`,
      )
    }
  }

  if (paypalTouched) {
    const missing = missingFrom(PAYPAL_REQUIRED)
    if (missing.length > 0) {
      throw new Error(
        `PayPal is partially configured — missing: ${missing.join(', ')}. Set the full set or clear all PayPal env vars to disable PayPal.`,
      )
    }
  }

  validatedEnv = {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    stripeCurrency: process.env.STRIPE_CURRENCY ?? 'ILS',
    paypalClientId: process.env.PAYPAL_CLIENT_ID ?? '',
    paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    paypalWebhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
    paypalSandbox: process.env.PAYPAL_SANDBOX !== 'false',
  }

  return validatedEnv
}

/**
 * Reset the cached environment (useful for testing)
 */
export function resetPaymentEnvCache(): void {
  validatedEnv = null
}
