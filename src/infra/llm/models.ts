/**
 * LLM Model Types - Config-Driven Configuration
 *
 * All model configurations are now loaded from ConfigValues (chat domain).
 * This file contains types and mapping helpers only.
 *
 * Configuration is stored in: config_values collection (domain: "chat")
 * Structure:
 * - models.exerciseChat: model settings for chat
 * - models.imageToExercise: model settings for image conversion
 * - models.pdfToExercise: model settings for PDF conversion
 *
 * Usage:
 * ```typescript
 * import { getModelConfig } from '@/infra/llm/providers/shared/chat-config'
 *
 * const config = await getModelConfig('openaiCompatible', 'exerciseChat')
 * // Returns: { name, temperature, maxOutputTokens, capabilities }
 * ```
 */

import { LLMProviderType } from './providers/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unified AI Model configuration
 * Used across all providers for consistent model representation
 */
export interface AIModel {
  /** Provider-specific model name (e.g., 'gemini-2.0-flash-001', 'MiniMax-M2.1') */
  name: string
  /** Generation temperature (0.0 - 2.0, lower = more deterministic) */
  temperature: number
  /** Maximum number of output tokens */
  maxOutputTokens: number
  /** Optional capability tags for feature detection */
  capabilities?: string[]
}

/**
 * Union type of all valid model keys
 * Maps to ConfigValues: chat → models.<key>
 */
export type AIModelKey = 'IMAGE_TO_EXERCISE' | 'EXERCISE_CHAT' | 'PDF_TO_EXERCISE'

/**
 * Map AIModelKey to ConfigValues task names
 */
const _CONFIG_TASK_MAP: Record<AIModelKey, 'imageToExercise' | 'exerciseChat' | 'pdfToExercise'> = {
  IMAGE_TO_EXERCISE: 'imageToExercise',
  EXERCISE_CHAT: 'exerciseChat',
  PDF_TO_EXERCISE: 'pdfToExercise',
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Type Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map LLMProviderType to ConfigValues provider names
 */
export function mapProviderToConfig(providerType: LLMProviderType): 'gemini' | 'openaiCompatible' {
  return providerType === LLMProviderType.GEMINI ? 'gemini' : 'openaiCompatible'
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability definitions for each task
 * These are fixed and cannot be changed via config
 */
export const TASK_CAPABILITIES: Record<AIModelKey, string[]> = {
  IMAGE_TO_EXERCISE: ['multimodal', 'vision'],
  EXERCISE_CHAT: ['multimodal', 'chat'],
  PDF_TO_EXERCISE: ['document', 'extraction'],
}

/**
 * Check if a model supports a specific capability
 */
export function modelSupportsCapability(modelKey: AIModelKey, capability: string): boolean {
  return TASK_CAPABILITIES[modelKey]?.includes(capability) ?? false
}

/**
 * Get all model keys that support a specific capability
 */
export function getModelsWithCapability(capability: string): AIModelKey[] {
  return (Object.keys(TASK_CAPABILITIES) as AIModelKey[]).filter((key) =>
    TASK_CAPABILITIES[key].includes(capability),
  )
}
