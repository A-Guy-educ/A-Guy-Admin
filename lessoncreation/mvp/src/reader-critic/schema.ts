/**
 * Zod schema for the reader critic — the sixth pipeline stage.
 *
 * Reads the FINAL rendered exercise (base drawing + 4 sections after writer
 * + materializer) and evaluates two axes:
 *   1. Semantic coherence — can a student answer each section from what's shown?
 *   2. Plan fidelity — does the rendered exercise deliver on the skeleton's intent?
 *
 * Per-exercise so findings map cleanly to a surgical fix path (writer regen +
 * materializer for that specific exercise number).
 */
import { z } from 'zod'

export const ReaderSeverity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])

export const ReaderFinding = z.object({
  severity: ReaderSeverity,
  sectionLetter: z
    .enum(['א', 'ב', 'ג', 'ד', 'exercise'])
    .describe(
      'Which section has the issue, or "exercise" for exercise-level issues (base drawing, cross-section coherence, plan fidelity of the whole exercise).',
    ),
  kind: z
    .enum(['sketch-mismatch', 'content-issue', 'plan-fidelity', 'other'])
    .describe(
      'What went wrong: sketch-mismatch (question refers to sketch elements that don\'t exist), content-issue (question is confusing / has math errors / missing values), plan-fidelity (rendered exercise doesn\'t deliver the planner\'s oneNewThing / expectedDiscovery), other.',
    ),
  issue: z
    .string()
    .describe(
      'One-sentence Hebrew description of what a student sees that\'s wrong. Be specific.',
    ),
  suggestedFix: z
    .string()
    .describe(
      'One-sentence Hebrew fix — what should change in the sketch or the question text.',
    ),
})

export const ReaderExerciseVerdict = z.object({
  exerciseNumber: z.number().int().min(1).max(10),
  passed: z
    .boolean()
    .describe('true iff there are ZERO CRITICAL and ZERO HIGH findings for this exercise.'),
  summary: z
    .string()
    .describe(
      'One-paragraph Hebrew summary of the exercise\'s quality — what works, what needs fixing. Empty when passed=true and no findings at all.',
    ),
  findings: z.array(ReaderFinding),
})

export type ReaderFinding = z.infer<typeof ReaderFinding>
export type ReaderExerciseVerdict = z.infer<typeof ReaderExerciseVerdict>
