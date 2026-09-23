/**
 * Planner stage — Gemini call that turns a `GenerationInput` into a
 * validated `LessonSkeleton`. This is stage 1 of the 4-stage pipeline
 * (Planner → Critic → Writer → Validator) described in the plan file.
 *
 * MVP-scoped: no retry, no critic loop yet. Just: call → parse → validate.
 */
import { generateJson } from '../gemini-client.js'
import { MODEL_PLANNER } from '../models.js'
import { buildSystemPrompt, buildUserPrompt } from './prompt.js'
import { LessonSkeleton } from './schema.js'
import type { GenerationInput } from './types.js'

export async function planLesson(input: GenerationInput): Promise<LessonSkeleton> {
  const skeleton = await generateJson({
    systemInstruction: buildSystemPrompt(),
    userPrompt: buildUserPrompt(input),
    schema: LessonSkeleton,
    modelName: MODEL_PLANNER,
    temperature: 0.3,
    maxOutputTokens: 16384,
  })

  // Enforce structural rules the schema can't easily express:
  // sections must be in canonical order and shape.
  for (const ex of skeleton.exercises) {
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
          `Exercise ${ex.number} section ${i + 1}: expected {letter=${letter}, shape=${shape}}, got {letter=${sec.letter}, shape=${sec.shape}}`,
        )
      }
    })
  }

  // Exercises must be numbered 1..10 in order.
  skeleton.exercises.forEach((ex, i) => {
    if (ex.number !== i + 1) {
      throw new Error(`Exercise position ${i + 1} has number=${ex.number}; must be sequential 1..10`)
    }
  })

  return skeleton
}
