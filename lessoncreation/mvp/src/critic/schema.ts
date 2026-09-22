/**
 * Zod schema for the critic stage's output.
 *
 * The critic reads a LessonSkeleton and returns a structured verdict:
 * either PASS (ship it) or a list of specific exercises that need a
 * surgical patch. Each finding carries enough context for the reviser
 * stage to regenerate ONLY the affected exercise without touching the
 * rest.
 *
 * The critic operates on the same rules the human sub-agents used in
 * iterations 1-3 of prompt-tuning — those rules are codified verbatim in
 * ./prompt.ts.
 */
import { z } from 'zod'

export const CriticSeverity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])

export const ExerciseFinding = z.object({
  exerciseNumber: z
    .number()
    .describe('Which exercise (1-10) has the problem. Use 0 for lesson-level issues.'),
  severity: CriticSeverity,
  rule: z
    .string()
    .describe(
      'The rule violated — one of: "visual-scaffold", "one-new-thing", "sequential-buildup", "perceptual-opening", "no-metacognitive-d", "synthesis-in-e10", "grade-scope", "other".',
    ),
  issue: z
    .string()
    .min(10)
    .describe('One-sentence Hebrew description of what is wrong with this exercise.'),
  suggestedFix: z
    .string()
    .min(10)
    .describe(
      'One-to-two-sentence Hebrew prescription for the reviser. Be specific — say what should change in this exercise so it passes the rule, given its neighbors E±1 stay fixed.',
    ),
})

export const CriticVerdict = z.object({
  passed: z
    .boolean()
    .describe(
      'true when the skeleton has ZERO CRITICAL findings and ZERO HIGH findings. MEDIUM/LOW findings are recorded but do not block PASS.',
    ),
  overallVerdict: z.enum(['PASS', 'PASS_WITH_FIXES', 'FAIL']),
  summary: z
    .string()
    .describe('One-paragraph Hebrew summary of the review — what works, what does not.'),
  findings: z
    .array(ExerciseFinding)
    .describe(
      'List of specific problems. Empty when passed=true. Ordered by severity (CRITICAL first).',
    ),
})

export type CriticVerdict = z.infer<typeof CriticVerdict>
export type ExerciseFinding = z.infer<typeof ExerciseFinding>
