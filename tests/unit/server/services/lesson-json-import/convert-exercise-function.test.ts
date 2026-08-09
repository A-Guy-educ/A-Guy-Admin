import { describe, expect, it } from 'vitest'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { convertExerciseToSections } from '@/server/services/lesson-json-import/convert-exercise'
import type { LessonJsonExercise } from '@/server/services/lesson-json-import/json-schema'

const FUNCTION_SOURCE = [
  '%%%',
  '$f(x) = x^2$',
  'color: #3366cc',
  'style: solid',
  'width: 2',
  '%%%',
  'x:[-5,5]',
  'y:[0,25]',
  '%%%',
  'grid: true',
  '%%%',
].join('\n')

function makeExercise(overrides: Partial<LessonJsonExercise['exercise_content']> = {}) {
  return {
    exercise_number: '1',
    topic: 'Functions',
    exercise_content: {
      sections: [
        {
          question_number: 'א',
          question: { text: 'Question?', function: FUNCTION_SOURCE },
          correct_option: { text: 'Correct' },
          wrong_options: [{ text: 'Wrong' }],
        },
      ],
      ...overrides,
    },
  } as LessonJsonExercise
}

describe('convertExerciseToSections — function blocks', () => {
  it('emits a question_axis block for a section-level function field', () => {
    const converted = convertExerciseToSections(makeExercise())

    expect(converted.sections[0].blocks.map((b) => b.type)).toEqual([
      'question_axis',
      'question_select',
    ])

    // Blocks must survive the collection schema; otherwise the importer
    // would roll back the whole lesson at ContentSchema.safeParse().
    expect(() => ContentSchema.parse({ blocks: converted.sections[0].blocks })).not.toThrow()
  })

  it('emits a question_axis block for a shared (exercise-level) function field', () => {
    const exercise = makeExercise({
      data: { text: 'Explanation', function: FUNCTION_SOURCE },
      sections: [
        {
          question_number: 'א',
          question: { text: 'Question?' },
          correct_option: { text: 'Correct' },
          wrong_options: [{ text: 'Wrong' }],
        },
      ],
    })

    const converted = convertExerciseToSections(exercise)

    // The shared block ordering mirrors blocksFromContext — svg → function →
    // text. Here we only supply function + text, so those two land in order.
    expect(converted.sharedBlocks.map((b) => b.type)).toEqual(['question_axis', 'rich_text'])
    expect(() => ContentSchema.parse({ blocks: converted.sharedBlocks })).not.toThrow()
  })
})
