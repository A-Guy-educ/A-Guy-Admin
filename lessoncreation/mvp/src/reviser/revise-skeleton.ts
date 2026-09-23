/**
 * Reviser stage — takes a skeleton + critic verdict, regenerates only the
 * CRITICAL/HIGH-flagged exercises, and returns a merged skeleton.
 *
 * The merge is mechanical: byte-identical for frozen exercises, replaced
 * for patched ones. That's what makes the loop safe against drift — the
 * model can't quietly rewrite exercises it wasn't asked to touch.
 */
import { generateJson } from '../gemini-client.js'
import type { CriticVerdict } from '../critic/schema.js'
import { MODEL_REVISER } from '../models.js'
import type { LessonSkeleton } from '../planner/schema.js'
import { buildReviserSystemPrompt, buildReviserUserPrompt, pickTargetExercises } from './prompt.js'
import { RevisedExercises } from './schema.js'

export interface RevisionResult {
  skeleton: LessonSkeleton
  patchedNumbers: number[]
  /** Empty when the critic returned no CRITICAL/HIGH findings — nothing to revise. */
  skipped: boolean
}

export async function reviseSkeleton(
  skeleton: LessonSkeleton,
  verdict: CriticVerdict,
): Promise<RevisionResult> {
  const targetNumbers = pickTargetExercises(verdict)
  if (targetNumbers.length === 0) {
    return { skeleton, patchedNumbers: [], skipped: true }
  }

  const revised = await generateJson({
    systemInstruction: buildReviserSystemPrompt(),
    userPrompt: buildReviserUserPrompt(skeleton, verdict, targetNumbers),
    schema: RevisedExercises,
    modelName: MODEL_REVISER,
    temperature: 0.3,
    maxOutputTokens: 16384,
  })

  // Merge: replace flagged exercises, keep the rest byte-identical.
  const patchedByNumber = new Map<number, (typeof revised.patchedExercises)[number]>()
  for (const patched of revised.patchedExercises) {
    patchedByNumber.set(patched.number, patched)
  }

  // Sanity: the reviser must have produced patches for every target number.
  const missing = targetNumbers.filter((n) => !patchedByNumber.has(n))
  if (missing.length > 0) {
    throw new Error(
      `Reviser did not produce patches for exercises: ${missing.join(', ')}. Got: ${revised.patchedExercises.map((p) => p.number).join(', ')}`,
    )
  }

  // Sanity: the reviser must not have produced patches for exercises NOT in
  // the target list (guards against silent drift).
  const extras = revised.patchedExercises.filter((p) => !targetNumbers.includes(p.number))
  if (extras.length > 0) {
    throw new Error(
      `Reviser produced patches for exercises it wasn't asked to touch: ${extras.map((e) => e.number).join(', ')}`,
    )
  }

  const mergedExercises = skeleton.exercises.map((ex) => patchedByNumber.get(ex.number) ?? ex)

  // Validate structural invariants on the merged skeleton.
  const merged: LessonSkeleton = { ...skeleton, exercises: mergedExercises }
  for (const ex of merged.exercises) {
    const expected = [
      ['א', 'mcq-2'],
      ['ב', 'mcq-2'],
      ['ג', 'mcq-3'],
      ['ד', 'free-response'],
    ] as const
    ex.sections.forEach((sec, i) => {
      const [letter, shape] = expected[i]
      if (sec.letter !== letter || sec.shape !== shape) {
        throw new Error(
          `Merged exercise ${ex.number} section ${i + 1} broken: expected ${letter}/${shape}, got ${sec.letter}/${sec.shape}`,
        )
      }
    })
  }

  return { skeleton: merged, patchedNumbers: targetNumbers, skipped: false }
}
