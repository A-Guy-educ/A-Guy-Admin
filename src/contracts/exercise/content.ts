import { z } from 'zod'
import { ExerciseBlockSchema } from './blocks'

/**
 * Exercise Content Schema
 *
 * Represents the complete content of an exercise.
 * - contentSchemaVersion: 1 (always)
 * - stem: Array of ExerciseBlock
 *
 * Note: Legacy "sections" are removed. Sections are now just blocks of type "section" within the stem.
 */

export const ExerciseContentSchema = z
  .object({
    contentSchemaVersion: z.literal(1).default(1),
    stem: z.array(ExerciseBlockSchema),
  })
  .strict()

export type ExerciseContent = z.infer<typeof ExerciseContentSchema>
