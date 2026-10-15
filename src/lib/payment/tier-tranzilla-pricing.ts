/**
 * Tranzilla tier-subscription pricing catalog.
 *
 * Admin-side source of truth for ILS prices per (tierSlug, offerSlug). Web
 * sends only {tierSlug, offerSlug} to the subscription bootstrap endpoint;
 * admin resolves the price here and snapshots the numbers onto the
 * Subscription row at bootstrap. Later catalog edits do NOT retroactively
 * affect existing subs — the row's snapshot is the contract.
 *
 * Starter numbers below are placeholders aligned with TIER_PRICE_ILS. Shai
 * will tune `intro3mo` values before launch; confirm before shipping.
 *
 * @fileType constants
 * @domain payments
 */

import type { TierSlug } from '@/lib/tiers/constants'

export type TranzillaOfferSlug = 'default' | 'intro3mo' | 'test'

export const TRANZILLA_OFFER_SLUGS: readonly TranzillaOfferSlug[] = [
  'default',
  'intro3mo',
  'test',
] as const

export interface TranzillaOffer {
  introPriceIls: number | null
  introChargesTotal: number | null
  regularPriceIls: number
}

// Partial — not every tier offers every slug. `test` is `basic`-only
// (used by web's /subtest smoke flow); advanced/premium intentionally
// omit it. resolveTranzillaOffer returns null on a tier/offer gap so
// the bootstrap endpoint can 400 the request instead of silently
// defaulting to another offer.
type TierOfferCatalog = Partial<Record<TranzillaOfferSlug, TranzillaOffer>>

// `free` is not a paid tier — the catalog only enumerates purchasable tiers.
export type PaidTierSlug = Exclude<TierSlug, 'free'>

export const PAID_TIER_SLUGS: readonly PaidTierSlug[] = ['basic', 'advanced', 'premium']

export const TIER_TRANZILLA_PRICING: Record<PaidTierSlug, TierOfferCatalog> = {
  basic: {
    default: { introPriceIls: null, introChargesTotal: null, regularPriceIls: 59 },
    intro3mo: { introPriceIls: 33, introChargesTotal: 3, regularPriceIls: 59 },
    // 1 ILS smoke-test offer for /subtest. Env-gated via
    // isOfferAllowedForEnvironment below — a prod deploy refuses the
    // offer even if someone passes `?offer=test` on the subscribe link.
    test: { introPriceIls: null, introChargesTotal: null, regularPriceIls: 1 },
  },
  advanced: {
    default: { introPriceIls: null, introChargesTotal: null, regularPriceIls: 119 },
    intro3mo: { introPriceIls: 50, introChargesTotal: 3, regularPriceIls: 119 },
  },
  premium: {
    default: { introPriceIls: null, introChargesTotal: null, regularPriceIls: 239 },
    intro3mo: { introPriceIls: 100, introChargesTotal: 3, regularPriceIls: 239 },
  },
}

export function isPaidTierSlug(value: unknown): value is PaidTierSlug {
  return value === 'basic' || value === 'advanced' || value === 'premium'
}

export function isTranzillaOfferSlug(value: unknown): value is TranzillaOfferSlug {
  return value === 'default' || value === 'intro3mo' || value === 'test'
}

/**
 * `test` offer is a 1 ILS smoke lever — refuse it in production even if
 * someone passes `?offer=test`. Belt-and-suspenders on top of the catalog
 * only exposing `test` for the basic tier.
 */
export function isOfferAllowedForEnvironment(offerSlug: TranzillaOfferSlug): boolean {
  if (offerSlug === 'test' && process.env.NODE_ENV === 'production') return false
  return true
}

export function resolveTranzillaOffer(
  tierSlug: PaidTierSlug,
  offerSlug: TranzillaOfferSlug,
): TranzillaOffer | null {
  return TIER_TRANZILLA_PRICING[tierSlug][offerSlug] ?? null
}

/**
 * Which ILS price should the NEXT charge on this subscription use, and is
 * that charge an intro-period charge? Returns the intro price while
 * `introChargesUsed < introChargesTotal`; otherwise the regular price.
 *
 * The counter is only incremented after a SUCCESSFUL charge (see
 * extendTierSubscription), so failed retries do not advance intro state.
 */
export function computeNextChargePriceIls(args: {
  introPriceIls: number | null
  introChargesTotal: number | null
  introChargesUsed: number
  regularPriceIls: number
}): { priceIls: number; isIntroCharge: boolean } {
  const { introPriceIls, introChargesTotal, introChargesUsed, regularPriceIls } = args
  if (
    introPriceIls !== null &&
    introChargesTotal !== null &&
    introChargesUsed < introChargesTotal
  ) {
    return { priceIls: introPriceIls, isIntroCharge: true }
  }
  return { priceIls: regularPriceIls, isIntroCharge: false }
}
