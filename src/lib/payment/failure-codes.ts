/**
 * Structured `Transactions.failureCode` values.
 *
 * Tranzila rows store the raw processor response code (e.g. '051') — see
 * `tranzillaFailureCode`. Every other failure path stores one of the slugs
 * below. The Dash revenue tab groups failed transactions by this field, so
 * treat existing values as a stable contract: add new slugs, don't rename.
 */
export const TX_FAILURE_CODES = {
  /** Tranzila decline with no response code in the callback body. */
  unknown: 'unknown',
  /** PayPal ACTIVATED arrived for a sub already cancelled/expired. */
  activationAbandoned: 'activation_abandoned',
  /** Stripe checkout.session.async_payment_failed. */
  asyncPaymentFailed: 'async_payment_failed',
  /** Stripe checkout.session.expired — buyer never completed checkout. */
  sessionExpired: 'session_expired',
  /** Tranzila bootstrap auto-expired a stale pending sub before retrying. */
  checkoutAbandoned: 'checkout_abandoned',
} as const

export function tranzillaFailureCode(responseCode: string | null | undefined): string {
  return responseCode || TX_FAILURE_CODES.unknown
}
