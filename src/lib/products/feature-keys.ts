/**
 * Product feature keys — each key represents a standalone entitlement
 * that can be bundled into a Product.
 *
 * @fileType utility
 * @domain billing
 */

/**
 * Enforcement status:
 *  - `ai-questions`, `chat-limit` — wired through feature-quota.ts;
 *    per-day enforcement is live.
 *  - All other keys are metadata-only at the moment: they appear in the
 *    admin and on featureEntitlements rows, but no runtime gate consumes
 *    them. Wire a FIELD_NAMES counter in feature-quota.ts before relying
 *    on a per-day cap for any of them.
 */
export const FEATURE_KEYS = [
  'live-sessions',
  'download-resources',
  'certificate',
  'priority-support',
  'analytics',
  'group-access',
  'ai-questions',
  'chat-limit',
  'exercise-generation',
  'study-plan-generation',
  'pdf-download',
  'pdf-print',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]
