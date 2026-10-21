/**
 * Tier constants — hardcoded enum.
 *
 * Source of truth: ../../../../TIERS.md (parent-folder shared doc).
 * The A-Guy-Web repo keeps a mirror of these values; keep them in sync.
 *
 * @fileType constants
 * @domain billing
 */

export const TIER_SLUGS = ['free', 'basic', 'advanced', 'premium'] as const

export type TierSlug = (typeof TIER_SLUGS)[number]

export const DEFAULT_TIER: TierSlug = 'free'

export const TIER_RANK: Record<TierSlug, number> = {
  free: 0,
  basic: 1,
  advanced: 2,
  premium: 3,
}

export const TIER_LABEL_HE: Record<TierSlug, string> = {
  free: 'חינם',
  basic: 'בסיס',
  advanced: 'מתקדם',
  premium: 'פרימיום',
}

export const TIER_LABEL_EN: Record<TierSlug, string> = {
  free: 'Free',
  basic: 'Basic',
  advanced: 'Advanced',
  premium: 'Premium',
}

export const TIER_PRICE_ILS: Record<TierSlug, number> = {
  free: 0,
  basic: 59,
  advanced: 119,
  premium: 239,
}

/**
 * Monthly internal AI cost cap (ILS). `null` = no hard cap (fair-use only).
 * Consumed by the Web app when it sets `user.llmTokensLimit` on tier change.
 */
export const TIER_AI_COST_CAP_ILS: Record<TierSlug, number | null> = {
  free: 1,
  basic: 10,
  advanced: 20,
  premium: null,
}

/**
 * Monthly LLM token cap per tier. `null` = no hard cap (fair-use only).
 * Written to `user.llmTokensLimit` when a tier purchase captures (see
 * applyTierPurchase). Mirror of A-Guy-Web/src/lib/tiers/constants.ts —
 * keep in sync. Values are tokens, not ILS.
 */
export const TIER_LLM_TOKEN_CAP_MONTHLY: Record<TierSlug, number | null> = {
  free: 1_500_000,
  basic: 15_000_000,
  advanced: 30_000_000,
  premium: null,
}

/**
 * Daily LLM token cap per tier — fixed ratio of 1/15 of the monthly cap.
 * Written to `user.llmTokensDailyLimit` when a tier purchase captures
 * (see applyTierPurchase). Mirror of A-Guy-Web/src/lib/tiers/constants.ts
 * — keep the ratio in sync. `null` = no daily cap (same as monthly:null).
 */
export const DAILY_TO_MONTHLY_RATIO = 15

export function dailyTokenCapFromMonthly(monthly: number | null): number | null {
  return monthly === null ? null : Math.floor(monthly / DAILY_TO_MONTHLY_RATIO)
}

export const TIER_LLM_TOKEN_CAP_DAILY: Record<TierSlug, number | null> = {
  free: dailyTokenCapFromMonthly(TIER_LLM_TOKEN_CAP_MONTHLY.free),
  basic: dailyTokenCapFromMonthly(TIER_LLM_TOKEN_CAP_MONTHLY.basic),
  advanced: dailyTokenCapFromMonthly(TIER_LLM_TOKEN_CAP_MONTHLY.advanced),
  premium: dailyTokenCapFromMonthly(TIER_LLM_TOKEN_CAP_MONTHLY.premium),
}

export function isTierSlug(value: unknown): value is TierSlug {
  return typeof value === 'string' && (TIER_SLUGS as readonly string[]).includes(value)
}
