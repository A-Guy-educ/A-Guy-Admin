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

export type TranzillaOfferSlug = 'default' | 'intro3mo'

export const TRANZILLA_OFFER_SLUGS: readonly TranzillaOfferSlug[] = ['default', 'intro3mo'] as const

export interface TranzillaOffer {
  introPriceIls: number | null
  introChargesTotal: number | null
  regularPriceIls: number
}

type TierOfferCatalog = Record<TranzillaOfferSlug, TranzillaOffer>

// `free` is not a paid tier — the catalog only enumerates purchasable tiers.
export type PaidTierSlug = Exclude<TierSlug, 'free'>

export const PAID_TIER_SLUGS: readonly PaidTierSlug[] = ['basic', 'advanced', 'premium']

export const TIER_TRANZILLA_PRICING: Record<PaidTierSlug, TierOfferCatalog> = {
  basic: {
    default: { introPriceIls: null, introChargesTotal: null, regularPriceIls: 59 },
    intro3mo: { introPriceIls: 33, introChargesTotal: 3, regularPriceIls: 59 },
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
  return value === 'default' || value === 'intro3mo'
}

export function resolveTranzillaOffer(
  tierSlug: PaidTierSlug,
  offerSlug: TranzillaOfferSlug,
): TranzillaOffer {
  return TIER_TRANZILLA_PRICING[tierSlug][offerSlug]
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
