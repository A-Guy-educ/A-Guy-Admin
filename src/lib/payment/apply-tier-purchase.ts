/**
 * applyTierPurchase — raw-Mongo update of a user's tier on a successful
 * tier-subscription capture.
 *
 * Writes `currentTier`, `llmTokensLimit` (monthly cap), and
 * `llmTokensDailyLimit` (daily cap, 1/15 of monthly) in a single $set so
 * the three stay consistent. Uses the raw driver (not `payload.update`)
 * because these fields are admin-only via Payload's access rules —
 * webhooks shouldn't be given admin personhood to update them, and the
 * whole point of the field-level `access.update` guards is that
 * server-authored writes go around them intentionally.
 *
 * Idempotent: calling with the same (userId, tierSlug) twice is a no-op
 * at the data level (same values). Callers are also expected to gate on
 * `transaction.entitlementsGrantedAt` to avoid redoing work on webhook
 * replays.
 *
 * Note on the daily cap: Web ALSO seeds `llmTokensDailyLimit` on login
 * iff it's never been set. The admin-side write here is authoritative
 * when a tier changes (upgrade / downgrade / webhook capture) — Web's
 * "never auto-overwrite" caveat applies to login seeding, not tier
 * transitions. If an admin set a custom cap manually and we subsequently
 * run a tier purchase, this will overwrite the custom value by design
 * (the tier transition is explicit intent).
 *
 * @fileType utility
 * @domain payments
 */

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

import {
  TIER_LLM_TOKEN_CAP_DAILY,
  TIER_LLM_TOKEN_CAP_MONTHLY,
  type TierSlug,
} from '@/lib/tiers/constants'
import { getUsersMongoCollection } from '@/server/services/internal/users-mongo-collection'

export async function applyTierPurchase(
  payload: Payload,
  userId: string,
  tierSlug: TierSlug,
): Promise<void> {
  const collection = getUsersMongoCollection(payload)
  if (!collection) {
    throw new Error('applyTierPurchase: raw MongoDB connection unavailable')
  }

  const monthlyCap = TIER_LLM_TOKEN_CAP_MONTHLY[tierSlug]
  const dailyCap = TIER_LLM_TOKEN_CAP_DAILY[tierSlug]

  await collection.updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        currentTier: tierSlug,
        llmTokensLimit: monthlyCap,
        llmTokensDailyLimit: dailyCap,
        updatedAt: new Date(),
      },
    },
  )
}
