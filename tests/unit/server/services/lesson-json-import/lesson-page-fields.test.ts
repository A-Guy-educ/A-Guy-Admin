import { describe, expect, it } from 'vitest'

import { LessonJsonSchema } from '@/server/services/lesson-json-import/json-schema'
import { lessonPageFieldsFromJson } from '@/server/services/lesson-json-import/lesson-page-fields'

describe('lessonPageFieldsFromJson', () => {
  it('maps every lesson-page key onto its lesson field', () => {
    expect(
      lessonPageFieldsFromJson({
        lesson_objective: 'objective',
        intro: 'intro',
        description: 'hook',
        public_explanation: 'explanation',
        formulas: '$a^2+b^2=c^2$',
        examples: 'example',
        common_mistakes: 'mistake',
        estimated_minutes: 15,
        keywords: ['יתר', ' ניצב '],
        seo_title: 'SEO title',
        meta_description: 'SEO description',
      }),
    ).toEqual({
      lessonObjective: 'objective',
      intro: 'intro',
      description: 'hook',
      publicExplanation: 'explanation',
      formulas: '$a^2+b^2=c^2$',
      examples: 'example',
      commonMistakes: 'mistake',
      estimatedMinutes: 15,
      meta: { title: 'SEO title', description: 'SEO description', keywords: 'יתר, ניצב' },
    })
  })

  it('leaves out missing and blank keys', () => {
    expect(lessonPageFieldsFromJson({ intro: '  ', keywords: ' , ' })).toEqual({})
  })

  it('is read from the lesson JSON alongside the exercises', () => {
    const parsed = LessonJsonSchema.parse({
      topic: 'משפט פיתגורס',
      estimated_minutes: '20',
      keywords: 'יתר, ניצב',
      exercises: [
        {
          exercise_number: 1,
          exercise_content: {
            sections: [
              {
                question: { text: 'q' },
                correct_option: { text: 'a' },
                wrong_options: [{ text: 'b' }],
              },
            ],
          },
        },
      ],
    })

    expect(lessonPageFieldsFromJson(parsed)).toEqual({
      estimatedMinutes: 20,
      meta: { keywords: 'יתר, ניצב' },
    })
  })
})
