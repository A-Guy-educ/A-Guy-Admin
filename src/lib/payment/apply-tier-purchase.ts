/**
 * applyTierPurchase — raw-Mongo update of a user's tier on a successful
 * tier-subscription capture.
 *
 * Writes `currentTier` and `llmTokensLimit` in a single $set so the two
 * stay consistent. Uses the raw driver (not `payload.update`) because
 * `currentTier` and `llmTokensLimit` are both admin-only via Payload's
 * access rules — webhooks shouldn't be given admin personhood to update
 * them, and the whole point of the field-level `access.update` guards is
 * that server-authored writes go around them intentionally.
 *
 * Idempotent: calling with the same (userId, tierSlug) twice is a no-op
 * at the data level (same values). Callers are also expected to gate on
 * `transaction.entitlementsGrantedAt` to avoid redoing work on webhook
 * replays.
 *
 * @fileType utility
 * @domain payments
 */

import { ObjectId } from 'mongodb'
import type { Payload } from 'payload'

import { TIER_LLM_TOKEN_CAP_MONTHLY, type TierSlug } from '@/lib/tiers/constants'
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

  const tokenCap = TIER_LLM_TOKEN_CAP_MONTHLY[tierSlug]

  await collection.updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        currentTier: tierSlug,
        llmTokensLimit: tokenCap,
        updatedAt: new Date(),
      },
    },
  )
}
