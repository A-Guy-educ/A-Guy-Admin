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
  growUserId: string
  growPageCode: string
  growWebhookKey: string
  growSandbox: boolean
  tranzillaTerminal: string
  tranzillaTerminalToken: string
  tranzillaPublicKey: string
  tranzillaPrivateKey: string
  tranzillaSandbox: boolean
  /**
   * Hand Shake / outgoing-iframe HMAC: when `true`, `createTranzillaCheckout`
   * appends a `response_hash` query param computed from the critical money
   * fields. Default `false` so the iframe URL stays identical to today's
   * shape until Shai is ready to flip Hand Shake on at the Tranzila terminal
   * dashboard. Toggling this ON while Hand Shake is OFF on the terminal is
   * harmless — Tranzila just ignores the extra param.
   */
  tranzillaHandShakeEnabled: boolean
  /**
   * When `true`, build the hosted iframe URL on Tranzila's newer DirectNG
   * endpoint (`directng.tranzila.com`) instead of the legacy
   * `direct.tranzila.com`. DirectNG uses a modernized form template and is
   * suspected to be where Hand Shake iframe signing actually works —
   * legacy's response_hash validation at GET time was discovered to be
   * no-op during 2026-10-19 probing. Default `false` to keep behavior
   * identical to today's shape until live-tested.
   */
  tranzillaUseDirectng: boolean
}

const STRIPE_REQUIRED = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const
const PAYPAL_REQUIRED = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] as const
const GROW_REQUIRED = ['GROW_USER_ID', 'GROW_PAGE_CODE', 'GROW_WEBHOOK_KEY'] as const
const TRANZILLA_REQUIRED = [
  'TRANZILLA_TERMINAL',
  'TRANZILLA_PUBLIC_KEY',
  'TRANZILLA_PRIVATE_KEY',
] as const

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
  const growTouched = anySet(GROW_REQUIRED)
  const tranzillaTouched = anySet(TRANZILLA_REQUIRED)

  if (!stripeTouched && !paypalTouched && !growTouched && !tranzillaTouched) {
    throw new Error(
      'No payment provider configured. Set Stripe (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET), PayPal (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID), Grow (GROW_USER_ID, GROW_PAGE_CODE, GROW_WEBHOOK_KEY), or Tranzilla (TRANZILLA_TERMINAL, TRANZILLA_PUBLIC_KEY, TRANZILLA_PRIVATE_KEY) environment variables.',
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

  if (growTouched) {
    const missing = missingFrom(GROW_REQUIRED)
    if (missing.length > 0) {
      throw new Error(
        `Grow is partially configured — missing: ${missing.join(', ')}. Set the full set or clear all Grow env vars to disable Grow.`,
      )
    }
  }

  if (tranzillaTouched) {
    const missing = missingFrom(TRANZILLA_REQUIRED)
    if (missing.length > 0) {
      throw new Error(
        `Tranzilla is partially configured — missing: ${missing.join(', ')}. Set the full set or clear all Tranzilla env vars to disable Tranzilla.`,
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
    growUserId: process.env.GROW_USER_ID ?? '',
    growPageCode: process.env.GROW_PAGE_CODE ?? '',
    growWebhookKey: process.env.GROW_WEBHOOK_KEY ?? '',
    growSandbox: process.env.GROW_SANDBOX !== 'false',
    tranzillaTerminal: process.env.TRANZILLA_TERMINAL ?? '',
    tranzillaTerminalToken: process.env.TRANZILLA_TERMINAL_TOKEN ?? '',
    tranzillaPublicKey: process.env.TRANZILLA_PUBLIC_KEY ?? '',
    tranzillaPrivateKey: process.env.TRANZILLA_PRIVATE_KEY ?? '',
    tranzillaSandbox: process.env.TRANZILLA_SANDBOX !== 'false',
    tranzillaHandShakeEnabled: process.env.TRANZILLA_HAND_SHAKE_ENABLED === 'true',
    tranzillaUseDirectng: process.env.TRANZILLA_USE_DIRECTNG === 'true',
  }

  return validatedEnv
}

/**
 * Reset the cached environment (useful for testing)
 */
export function resetPaymentEnvCache(): void {
  validatedEnv = null
}
