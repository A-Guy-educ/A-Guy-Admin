/**
 * Product feature keys — each key represents a standalone entitlement
 * that can be bundled into a Product.
 *
 * @fileType utility
 * @domain billing
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
