import type { CollectionConfig } from 'payload'
import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { ExerciseContentSchema, AnswerSpecSchema } from '../contracts'

/**
 * Exercises Collection - Stage 1
 *
 * Field-level validation + default templates for better Admin UX
 */

// Default templates
const DEFAULT_CONTENT_JSON = {
  stem: [
    {
      id: 'b1',
      type: 'rich_text',
      format: 'md-math-v1',
      value: 'Write your question here. Example: $2x+3=11$',
    },
  ],
}

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
    defaultColumns: ['title', 'lesson', 'questionType', 'updatedAt'],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: {
        description: 'Exercise title (for admin reference)',
      },
    },
    {
      name: 'lesson',
      type: 'relationship',
      relationTo: 'lessons',
      required: true,
      index: true,
      admin: {
        description: 'The lesson this exercise belongs to',
      },
    },
    {
      name: 'questionType',
      type: 'select',
      required: true,
      options: [
        {
          label: 'Multiple Choice (MCQ)',
          value: 'mcq',
        },
        {
          label: 'True/False',
          value: 'true_false',
        },
        {
          label: 'Free Response',
          value: 'free_response',
        },
      ],
      admin: {
        description: 'Question type - must match answerSpecJson.questionType',
      },
    },
    {
      name: 'contentJson',
      type: 'json',
      required: true,
      defaultValue: DEFAULT_CONTENT_JSON,
      validate: (value) => {
        const result = ExerciseContentSchema.safeParse(value)
        if (!result.success) {
          const errors = result.error.issues
            .map((issue) => {
              const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
              return `${path}${issue.message}`
            })
            .join('\n')
          return errors || 'Invalid content structure'
        }
        return true
      },
      admin: {
        description: 'Exercise content blocks (stem + optional sections)',
      },
    },
    {
      name: 'answerSpecJson',
      type: 'json',
      required: true,
      defaultValue: DEFAULT_ANSWER_MCQ,
      validate: (value, { data }) => {
        // Validate structure with Zod
        const result = AnswerSpecSchema.safeParse(value)
        if (!result.success) {
          const errors = result.error.issues
            .map((issue) => {
              const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
              return `${path}${issue.message}`
            })
            .join('\n')
          return errors || 'Invalid answer specification'
        }

        // Check questionType consistency
        const questionType = (data as any)?.questionType
        if (questionType && result.data.questionType !== questionType) {
          return `Question type mismatch: this field has questionType="${result.data.questionType}" but the Question Type field is set to "${questionType}". These must match.`
        }

        return true
      },
      admin: {
        description: 'Answer specification - must match the selected Question Type above',
      },
    },
  ],
}
