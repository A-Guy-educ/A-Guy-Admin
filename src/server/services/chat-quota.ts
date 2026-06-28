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
import { ObjectId, type Collection, type Document } from 'mongodb'
import { getChatConfig } from '@/infra/llm/providers/shared/chat-config'
import { hoursToMs } from '@/infra/utils/time'
import type { Payload } from 'payload'

import {
  checkAndIncrementFeatureQuota,
  getFeatureQuotaStatus,
  resolveFeatureEntitlement,
} from './feature-quota'

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

function getUsersCollection(payload: Payload): Collection<Document> | null {
  const db = payload.db as unknown as {
    connection?: { collection?: (name: string) => unknown }
    collections?: Record<string, unknown>
    collection?: (name: string) => unknown
  }

  const collection =
    db.connection?.collection?.('users') ||
    db.collections?.['users'] ||
    (db.collections as Record<string, unknown>)?.users ||
    db.collection?.('users') ||
    null

  return (collection as Collection<Document>) ?? null
}

/**
 * Apply the silent `chat-limit` cap. Returns a silent denial if exceeded
 * and the previous result was allowed. Callers must check `silent` before
 * surfacing quota numbers.
 */
async function applyChatLimit(
  payload: Payload,
  userId: string,
  prior: ChatQuotaResult,
): Promise<ChatQuotaResult> {
  if (!prior.allowed) return prior
  const entitlement = await resolveFeatureEntitlement(payload, userId, 'chat-limit')
  if (!entitlement || entitlement.value === null) return prior
  const result = await checkAndIncrementFeatureQuota(payload, userId, 'chat-limit', entitlement)
  if (!result.allowed) {
    return {
      allowed: false,
      questionsUsed: prior.questionsUsed,
      maxQuestions: prior.maxQuestions,
      resetAt: prior.resetAt,
      silent: true,
    }
  }
  return prior
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
    return applyChatLimit(payload, userId, baseResult)
  }

  const legacyResult = await checkAndIncrementLegacyRollingQuota(payload, userId)
  return applyChatLimit(payload, userId, legacyResult)
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

  const collection = getUsersCollection(payload)

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
  const aiQuestionsEntitlement = await resolveFeatureEntitlement(payload, userId, 'ai-questions')
  if (aiQuestionsEntitlement) {
    const featureStatus = await getFeatureQuotaStatus(
      payload,
      userId,
      'ai-questions',
      aiQuestionsEntitlement,
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

  const user = await payload.findByID({ collection: 'users', id: userId })
  const windowStart = user.chatWindowStart ? new Date(user.chatWindowStart) : null
  let questionsUsed = user.chatQuestionsUsed ?? 0

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
