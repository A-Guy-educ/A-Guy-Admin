import type { CollectionConfig } from 'payload'
import { ValidationError } from 'payload'
import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { AnswerSpecSchema, ExerciseContentSchema } from '../contracts'
import { throwPayloadValidationError } from '../utilities/zodToPayloadError'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

/**
 * Exercises Collection — Content vNext (simple)
 *
 * ✅ New target structure:
 *   exercise.content = { blocks: [] }
 *
 * ✅ Backward compatibility (read/validate legacy):
 *   - Accept legacy contentJson shapes that still validate with ExerciseContentSchema
 *     (e.g., { contentSchemaVersion, stem } and/or hierarchical container variants)
 *
 * NOTE:
 * - We intentionally rename the Payload field from `contentJson` to `content`.
 * - The Admin custom field component must read/write this new shape.
 */

// New minimal schema: { blocks: [] }
const ContentVNextSchema = z
  .object({
    blocks: z.array(z.unknown()),
  })
  .strict()

// Default content (function -> unique IDs per doc)
const DEFAULT_CONTENT = () => ({
  blocks: [
    {
      id: randomUUID(),
      type: 'rich_text',
      format: 'md-math-v1',
      value: '# Write your question here\n\nExample: Solve for $x$: $2x+3=11$',
    },
  ],
})

const DEFAULT_ANSWER_MCQ = {
  questionType: 'mcq',
  multiSelect: false,
  options: [
    {
      id: 'o1',
      content: [{ id: 't1', type: 'rich_text', format: 'md-math-v1', value: 'Option A' }],
    },
    {
      id: 'o2',
      content: [{ id: 't2', type: 'rich_text', format: 'md-math-v1', value: 'Option B' }],
    },
  ],
  correctOptionIds: ['o1'],
}

const DEFAULT_ANSWER_TRUE_FALSE = {
  questionType: 'true_false',
  correct: true,
}

const DEFAULT_ANSWER_FREE_RESPONSE = {
  questionType: 'free_response',
  responseKind: 'numeric',
  acceptedAnswers: ['4'],
  tolerance: 0,
}

export const Exercises: CollectionConfig = {
  slug: 'exercises',
  access: {
    create: authenticated,
    delete: authenticated,
    read: anyone,
    update: authenticated,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['order', 'title', 'lesson', 'questionType', 'updatedAt'],
  },
  fields: [
    // Section 1: Exercise Meta (Basics)
    {
      type: 'collapsible',
      label: 'Exercise Meta (Basics)',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          admin: { description: 'Exercise title (for admin reference)' },
        },
        {
          name: 'order',
          type: 'number',
          required: true,
          defaultValue: 0,
          admin: {
            description: 'Order of exercise within the lesson (lower numbers appear first)',
          },
        },
        {
          name: 'lesson',
          type: 'relationship',
          relationTo: 'lessons',
          required: true,
          index: true,
          admin: { description: 'The lesson this exercise belongs to' },
        },
        {
          name: 'questionType',
          type: 'select',
          required: true,
          options: [
            { label: 'Multiple Choice (MCQ)', value: 'mcq' },
            { label: 'True/False', value: 'true_false' },
            { label: 'Free Response', value: 'free_response' },
          ],
          admin: { description: 'Question type - must match answerSpecJson.questionType' },
        },
      ],
    },

    // Section 2: Content
    {
      type: 'collapsible',
      label: 'Content',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'content',
          type: 'json',
          required: true,
          defaultValue: DEFAULT_CONTENT,
          validate: (value: unknown) => {
            // 1) NEW structure: { blocks: [] }
            const next = ContentVNextSchema.safeParse(value)
            if (next.success) return true

            // 2) Legacy support: accept old formats to avoid breaking existing DB
            const legacy = ExerciseContentSchema.safeParse(value)
            if (legacy.success) return true

            return 'Invalid content. Expected { blocks: [] } (or legacy format).'
          },
          admin: {
            description: 'Exercise content. Format: { blocks: [] }',
            components: {
              Field: '@/components/admin/ExerciseContentEditor#ExerciseContentEditor',
            },
          },
        },
      ],
    },

    // Section 3: Answer
    {
      type: 'collapsible',
      label: 'Answer',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'answerSpecJson',
          type: 'json',
          required: true,
          defaultValue: DEFAULT_ANSWER_MCQ,
          validate: (value, { data }) => {
            const result = AnswerSpecSchema.safeParse(value)
            if (!result.success) {
              throwPayloadValidationError(result.error, 'answerSpecJson')
            }

            const questionType = (data as any)?.questionType
            if (questionType && result.data.questionType !== questionType) {
              throw new ValidationError({
                errors: [
                  {
                    path: 'answerSpecJson.questionType',
                    message: `Question type mismatch: this field has questionType="${result.data.questionType}" but the Question Type field is set to "${questionType}". These must match.`,
                  },
                ],
              })
            }

            return true
          },
          admin: {
            description: 'Answer specification - must match the selected Question Type above',
            components: {
              Field: '@/components/admin/AnswerSpecJsonField#AnswerSpecJsonField',
            },
          },
        },
      ],
    },
  ],
}
