/**
 * Chat Quota Service
 *
 * Two-layer enforcement:
 *   1. `ai-questions` feature entitlement (user-visible per-day cap) — when
 *      a user has this entitlement, its value/period drives the quota and
 *      the legacy rolling-window logic is bypassed.
 *   2. `chat-limit` feature entitlement (silent server-side cap) — checked
 *      additionally; on hit, returns `{ allowed: false, silent: true }` so
 *      the endpoint can respond without revealing the numeric ceiling.
 *
 * Users without an `ai-questions` entitlement fall through to the original
 * rolling-window quota (config-driven defaults).
 *
 * @fileType service
 * @domain chat
 * @pattern rolling-window-quota, daily-feature-quota, silent-cap
 * @ai-summary Coordinates entitlement-driven daily quotas with the legacy rolling-window fallback
 */
import { ObjectId } from 'mongodb'
import { getChatConfig } from '@/infra/llm/providers/shared/chat-config'
import { hoursToMs } from '@/infra/utils/time'
import type { Payload } from 'payload'

import {
  checkAndIncrementFeatureQuota,
  decrementFeatureQuota,
  getFeatureQuotaStatus,
  resolveFeatureEntitlement,
  resolveFeatureEntitlementWithUser,
  type FeatureEntitlement,
} from './feature-quota'
import { getUsersMongoCollection } from './internal/users-mongo-collection'

const QUOTA_DEFAULTS = { maxQuestions: 15, windowHours: 12 }

export interface ChatQuotaResult {
  allowed: boolean
  questionsUsed: number
  maxQuestions: number
  resetAt: string | null
  /**
   * When true, denial originates from a silent cap (e.g. `chat-limit`).
   * Callers must NOT echo `questionsUsed` / `maxQuestions` / `resetAt`
   * back to the client and must return a generic error message.
   */
  silent?: boolean
}

async function getQuotaConfig() {
  try {
    const config = await getChatConfig()
    return { ...QUOTA_DEFAULTS, ...config.quota }
  } catch {
    return QUOTA_DEFAULTS
  }
}

/**
 * Apply the silent `chat-limit` cap. Returns a silent denial if exceeded
 * and the previous result was allowed. Callers must check `silent` before
 * surfacing quota numbers.
 */
/**
 * Pre-check the silent `chat-limit` cap WITHOUT incrementing it. Returns
 * `{ shouldDeny: true }` when the user is already at the daily limit so the
 * caller can skip the visible counter increment entirely. This avoids the
 * compensate-after-the-fact race where a concurrent request would observe
 * an inflated visible counter between the visible increment and the
 * compensation decrement.
 *
 * Returns `null` when the user has no chat-limit entitlement (no cap).
 */
async function chatLimitPreCheck(
  payload: Payload,
  userId: string,
): Promise<{ entitlement: FeatureEntitlement; shouldDeny: boolean } | null> {
  // The entitlement resolved here is reused by spendChatLimitAfterPrior so we
  // don't re-read the user document twice. Tiny race window: if a refund hook
  // fires between pre-check and consume, we'd be enforcing a silent cap
  // against an entitlement the user no longer holds. Worst case is one extra
  // silent denial — fail-stricter, not a security issue. Do not "fix" by
  // re-resolving inside the consume step; that just introduces a different
  // race and removes the entitlement-capture invariant.
  const entitlement = await resolveFeatureEntitlement(payload, userId, 'chat-limit')
  if (!entitlement || entitlement.value === null) return null
  const status = await getFeatureQuotaStatus(payload, userId, 'chat-limit', entitlement)
  return { entitlement, shouldDeny: !status.allowed }
}

/**
 * After the visible counter has been incremented and the pre-check passed,
 * spend the chat-limit budget. The remaining race window — both buckets
 * pass pre-check, then both attempt to spend chat-limit — is small and
 * compensation is logged but not surfaced as a different user-facing error.
 */
async function spendChatLimitAfterPrior(
  payload: Payload,
  userId: string,
  prior: ChatQuotaResult,
  entitlement: FeatureEntitlement | null,
  compensate: () => Promise<void>,
): Promise<ChatQuotaResult> {
  if (!prior.allowed) return prior
  if (!entitlement) return prior
  const result = await checkAndIncrementFeatureQuota(payload, userId, 'chat-limit', entitlement)
  if (result.allowed) return prior
  // Race lost — another request consumed the last chat-limit slot. Roll
  // back the visible counter so the user isn't billed for a request they
  // never received.
  try {
    await compensate()
  } catch (error) {
    payload.logger.error(
      { err: error, userId },
      'chat-quota: failed to compensate visible counter after silent chat-limit denial',
    )
  }
  return {
    allowed: false,
    questionsUsed: Math.max(0, prior.questionsUsed - 1),
    maxQuestions: prior.maxQuestions,
    resetAt: prior.resetAt,
    silent: true,
  }
}

/**
 * Check if user has quota remaining and increment if so.
 *
 * When the user has an `ai-questions` feature entitlement, that drives the
 * visible quota (per-day, Asia/Jerusalem). Otherwise we fall through to the
 * legacy rolling-window quota. Either way, an additional silent `chat-limit`
 * cap is applied last.
 *
 * Uses atomic findOneAndUpdate to prevent race conditions.
 */
export async function checkAndIncrementChatQuota(
  payload: Payload,
  userId: string,
): Promise<ChatQuotaResult> {
  // Pre-check the silent chat-limit cap BEFORE touching the visible counter
  // so the common silent-denial path never charges the user. The remaining
  // race window (chat-limit fills between pre-check and post-increment) is
  // handled by spendChatLimitAfterPrior with compensation.
  const chatLimitPre = await chatLimitPreCheck(payload, userId)
  if (chatLimitPre?.shouldDeny) {
    return {
      allowed: false,
      // Surface the visible-quota state without incrementing it. We don't
      // expose `questionsUsed` from the pre-check because we haven't read
      // the visible quota yet; clients only need to know it's denied.
      questionsUsed: 0,
      maxQuestions: 0,
      resetAt: null,
      silent: true,
    }
  }

  // Entitlement-driven path: `ai-questions` overrides the rolling-window default.
  const aiQuestionsEntitlement = await resolveFeatureEntitlement(payload, userId, 'ai-questions')
  if (aiQuestionsEntitlement) {
    const featureResult = await checkAndIncrementFeatureQuota(
      payload,
      userId,
      'ai-questions',
      aiQuestionsEntitlement,
    )
    const baseResult: ChatQuotaResult = {
      allowed: featureResult.allowed,
      questionsUsed: featureResult.used,
      maxQuestions: Number.isFinite(featureResult.limit) ? featureResult.limit : 0,
      resetAt: featureResult.resetAt,
    }
    return spendChatLimitAfterPrior(
      payload,
      userId,
      baseResult,
      chatLimitPre?.entitlement ?? null,
      () => decrementFeatureQuota(payload, userId, 'ai-questions'),
    )
  }

  const legacyResult = await checkAndIncrementLegacyRollingQuota(payload, userId)
  return spendChatLimitAfterPrior(
    payload,
    userId,
    legacyResult,
    chatLimitPre?.entitlement ?? null,
    () => decrementLegacyChatQuota(payload, userId),
  )
}

/**
 * Compensation helper for the legacy rolling-window quota. Mirrors
 * `decrementFeatureQuota` but targets the older `chatQuestionsUsed` field.
 */
async function decrementLegacyChatQuota(payload: Payload, userId: string): Promise<void> {
  const collection = getUsersMongoCollection(payload)
  if (!collection) return
  await collection.updateOne(
    { _id: new ObjectId(userId), chatQuestionsUsed: { $gt: 0 } },
    { $inc: { chatQuestionsUsed: -1 } },
  )
}

/**
 * Legacy rolling-window quota — used when the user has no `ai-questions`
 * feature entitlement. Preserves the pre-Task-C behavior for existing
 * non-paying users.
 */
async function checkAndIncrementLegacyRollingQuota(
  payload: Payload,
  userId: string,
): Promise<ChatQuotaResult> {
  const { maxQuestions, windowHours } = await getQuotaConfig()
  const now = new Date()
  const windowMs = hoursToMs(windowHours)
  const cutoffDate = new Date(now.getTime() - windowMs) // time before which window is expired

  const collection = getUsersMongoCollection(payload)

  // Fallback to non-atomic path if collection is unavailable
  if (!collection) {
    const user = await payload.findByID({ collection: 'users', id: userId })
    const windowStart = user?.chatWindowStart ? new Date(user.chatWindowStart) : null
    let questionsUsed = user?.chatQuestionsUsed ?? 0

    const windowExpired = !windowStart || now.getTime() - windowStart.getTime() > windowMs
    if (windowExpired) {
      questionsUsed = 0
    }

    if (questionsUsed >= maxQuestions) {
      const resetAt = windowStart ? new Date(windowStart.getTime() + windowMs).toISOString() : null
      return { allowed: false, questionsUsed, maxQuestions, resetAt }
    }

    const newWindowStart = windowExpired ? now.toISOString() : user?.chatWindowStart
    const newCount = questionsUsed + 1

    await payload.update({
      collection: 'users',
      id: userId,
      data: {
        chatQuestionsUsed: newCount,
        chatWindowStart: newWindowStart,
      },
      overrideAccess: true,
    })

    const resetAt = newWindowStart
      ? new Date(new Date(newWindowStart).getTime() + windowMs).toISOString()
      : null

    return { allowed: true, questionsUsed: newCount, maxQuestions, resetAt }
  }

  // Try atomic increment (window still valid)
  let result = await collection.findOneAndUpdate(
    {
      _id: new ObjectId(userId),
      chatWindowStart: { $gte: cutoffDate }, // window not expired
      chatQuestionsUsed: { $lt: maxQuestions },
    },
    { $inc: { chatQuestionsUsed: 1 } },
    { returnDocument: 'after' },
  )

  if (result) {
    const resetAt = new Date(new Date(result.chatWindowStart).getTime() + windowMs).toISOString()
    return { allowed: true, questionsUsed: result.chatQuestionsUsed, maxQuestions, resetAt }
  }

  // Window expired — try atomic reset to 1 (not increment from existing value)
  result = await collection.findOneAndUpdate(
    {
      _id: new ObjectId(userId),
      chatWindowStart: { $lt: cutoffDate }, // window expired
    },
    { $set: { chatWindowStart: now, chatQuestionsUsed: 1 } },
    { returnDocument: 'after' },
  )

  if (result) {
    // New window started at `now`, one question consumed
    const resetAt = new Date(now.getTime() + windowMs).toISOString()
    return { allowed: true, questionsUsed: 1, maxQuestions, resetAt }
  }

  // Both atomics failed — user is at limit in a valid window (race)
  const fresh = await payload.findByID({ collection: 'users', id: userId })
  const windowStart = fresh?.chatWindowStart ? new Date(fresh.chatWindowStart) : null
  const windowExpired = !windowStart || now.getTime() - windowStart.getTime() > windowMs
  const questionsUsed = windowExpired ? 0 : (fresh?.chatQuestionsUsed ?? 0)
  const resetAt = windowStart ? new Date(windowStart.getTime() + windowMs).toISOString() : null

  return { allowed: questionsUsed < maxQuestions, questionsUsed, maxQuestions, resetAt }
}

/**
 * Get current quota status without incrementing.
 *
 * Returns the entitlement-driven quota when the user has an `ai-questions`
 * entitlement. NEVER exposes `chat-limit` data — that cap is silent.
 */
export async function getChatQuotaStatus(
  payload: Payload,
  userId: string,
): Promise<ChatQuotaResult> {
  // Use the *WithUser variant so getFeatureQuotaStatus can read the same
  // user document we already loaded — one findByID instead of two.
  const { entitlement: aiQuestionsEntitlement, user } = await resolveFeatureEntitlementWithUser(
    payload,
    userId,
    'ai-questions',
  )
  if (aiQuestionsEntitlement) {
    const featureStatus = await getFeatureQuotaStatus(
      payload,
      userId,
      'ai-questions',
      aiQuestionsEntitlement,
      user,
    )
    return {
      allowed: featureStatus.allowed,
      questionsUsed: featureStatus.used,
      maxQuestions: Number.isFinite(featureStatus.limit) ? featureStatus.limit : 0,
      resetAt: featureStatus.resetAt,
    }
  }

  const { maxQuestions, windowHours } = await getQuotaConfig()
  const now = new Date()

  const legacyUser = await payload.findByID({ collection: 'users', id: userId })
  const windowStart = legacyUser.chatWindowStart ? new Date(legacyUser.chatWindowStart) : null
  let questionsUsed = legacyUser.chatQuestionsUsed ?? 0

  const windowMs = hoursToMs(windowHours)
  const windowExpired = !windowStart || now.getTime() - windowStart.getTime() > windowMs

  if (windowExpired) {
    questionsUsed = 0
  }

  const resetAt =
    windowStart && !windowExpired ? new Date(windowStart.getTime() + windowMs).toISOString() : null

  return {
    allowed: questionsUsed < maxQuestions,
    questionsUsed,
    maxQuestions,
    resetAt,
  }
}
