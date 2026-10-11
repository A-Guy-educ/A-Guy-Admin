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

export function isTierSlug(value: unknown): value is TierSlug {
  return typeof value === 'string' && (TIER_SLUGS as readonly string[]).includes(value)
}
