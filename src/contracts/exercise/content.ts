import { z } from 'zod'
import { BlockIdSchema } from '../primitives'

/**
 * Exercise Content Schema - Simplified Single Level
 *
 * Represents the complete content of an exercise.
 * - contentSchemaVersion: 1 (always)
 * - stem: Array of RichTextBlock only (no sections, no nesting)
 *
 * Single-level structure for simplicity and better UX.
 */

/** Rich text block - the only block type supported */
const RichTextBlockSchema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('rich_text'),
    format: z.literal('md-math-v1'),
    value: z.string().min(1),
  })
  .strict()

export const ExerciseContentSchema = z
  .object({
    contentSchemaVersion: z.literal(1).default(1),
    stem: z.array(RichTextBlockSchema),
  })
  .strict()

export type ExerciseContent = z.infer<typeof ExerciseContentSchema>
export type RichTextBlock = z.infer<typeof RichTextBlockSchema>
