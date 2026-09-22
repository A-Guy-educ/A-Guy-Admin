/**
 * Critic stage — Gemini call that reads a LessonSkeleton and returns a
 * CriticVerdict. Stage 2 of the 4-stage pipeline. Feeds the reviser stage
 * with structured findings.
 *
 * Uses gemini-2.5-flash (same as planner) — the critic is a pattern-
 * matcher, not a reasoning task. If quality is insufficient we can bump
 * to gemini-3.1-pro-preview later.
 */
import { generateJson } from '../gemini-client.js'
import type { LessonSkeleton } from '../planner/schema.js'
import { buildCriticSystemPrompt, buildCriticUserPrompt } from './prompt.js'
import { CriticVerdict } from './schema.js'

export async function critiqueSkeleton(skeleton: LessonSkeleton): Promise<CriticVerdict> {
  const verdict = await generateJson({
    systemInstruction: buildCriticSystemPrompt(),
    userPrompt: buildCriticUserPrompt(skeleton),
    schema: CriticVerdict,
    modelName: 'gemini-2.5-flash',
    temperature: 0.1, // Low: we want the critic to apply rules consistently, not creatively.
    maxOutputTokens: 16384,
  })

  // Consistency check: passed should be true iff no CRITICAL/HIGH findings.
  const hasBlocking = verdict.findings.some(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
  )
  if (verdict.passed && hasBlocking) {
    // Contradiction — trust the findings over the flag.
    return { ...verdict, passed: false, overallVerdict: 'FAIL' }
  }

  return verdict
}
