/**
 * Subscription-status transition helpers for tier-recompute gating.
 *
 * The recomputeUserTier read + CAS write is a webhook-critical-path
 * round-trip (users + subs + txs + products + tiers). Firing it on
 * every sub-status write — including known no-op moves like
 * active↔past_due — burns budget for no derived-state change.
 *
 * The sub filter in recomputeUserTier admits three statuses as
 * tier-granting: `active`, `past_due`, and `cancelled`+cancelAtPeriodEnd+
 * within-period. `cancelled` is only *conditionally* granting, so a
 * transition into/out of it may or may not flip tier — we treat it
 * conservatively as tier-affecting. Only transitions strictly within
 * the definitely-granting pair {active, past_due} are guaranteed
 * no-ops from the tier's perspective; the rest need a recompute.
 *
 * @fileType utility
 * @domain billing
 * @pattern gating, derived-state
 */

/**
 * True when a subscription status transition can plausibly change the
 * user's tier. False for same-status writes and for pure moves within
 * {active, past_due}.
 */
export function canTransitionFlipTier(
  oldStatus: string | undefined,
  newStatus: string | undefined,
): boolean {
  if (!newStatus) return false
  if (oldStatus === newStatus) return false
  const guaranteedGranting: ReadonlySet<string> = new Set(['active', 'past_due'])
  if (
    oldStatus !== undefined &&
    guaranteedGranting.has(oldStatus) &&
    guaranteedGranting.has(newStatus)
  ) {
    return false
  }
  return true
}
