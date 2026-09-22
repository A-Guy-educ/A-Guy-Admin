/**
 * Schema for the reviser's output. It returns a partial skeleton — just
 * the exercises it patched. The caller merges those into the original
 * skeleton at the same positions.
 *
 * We use z.array(ExercisePlan) rather than the full LessonSkeleton to
 * make it explicit: the reviser must NOT touch unmarked exercises. If it
 * returned a full skeleton, we'd have to trust the model to leave frozen
 * exercises byte-identical; by returning only patches we make freezing
 * a mechanical merge instead of a model behavior.
 */
import { z } from 'zod'

import { ExercisePlan } from '../planner/schema.js'

export const RevisedExercises = z.object({
  patchedExercises: z
    .array(ExercisePlan)
    .describe(
      'The exercises that were revised, one entry per exerciseNumber listed in the critic findings. Each entry must have the exercise number of the exercise it replaces.',
    ),
})

export type RevisedExercises = z.infer<typeof RevisedExercises>
