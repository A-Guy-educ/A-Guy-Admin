/**
 * Pedagogical critic — companion to the rule-based structural critic.
 * Same schema (CriticVerdict), different mindset: teacher role, no
 * explicit rule list, applies pedagogical common sense.
 *
 * Runs in parallel with the structural critic (see pipeline.ts). Findings
 * combine into one list for the reviser to consume.
 */
import { generateJson } from '../gemini-client.js'
import { MODEL_CRITIC } from '../models.js'
import type { LessonSkeleton } from '../planner/schema.js'
import {
  buildPedagogicalCriticSystemPrompt,
  buildPedagogicalCriticUserPrompt,
} from './pedagogical-prompt.js'
import { CriticVerdict } from './schema.js'

export async function critiquePedagogically(skeleton: LessonSkeleton): Promise<CriticVerdict> {
  const verdict = await generateJson({
    systemInstruction: buildPedagogicalCriticSystemPrompt(),
    userPrompt: buildPedagogicalCriticUserPrompt(skeleton),
    schema: CriticVerdict,
    modelName: MODEL_CRITIC,
    temperature: 0.3, // Slightly higher than structural — reasoning benefits from a touch of variability.
    maxOutputTokens: 16384,
  })

  // Consistency: `passed` should be true iff no CRITICAL/HIGH.
  const hasBlocking = verdict.findings.some(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
  )
  if (verdict.passed && hasBlocking) {
    return { ...verdict, passed: false, overallVerdict: 'FAIL' }
  }
  return verdict
}
