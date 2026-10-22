import { describe, expect, it } from 'vitest'

import {
  buildCanonicalLessonExport,
  exerciseWithSectionsToCanonical,
} from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'

function richText(id: string, value: string) {
  return { id, type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

function inlineRich(value: string) {
  return { type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

function mcqSection(id: string, prompt: string, correct: string, wrong: string[]) {
  const options = [
    { id: 'opt-c', content: inlineRich(correct) },
    ...wrong.map((w, i) => ({ id: `opt-w-${i}`, content: inlineRich(w) })),
  ]
  return {
    id,
    content: {
      blocks: [
        {
          id: `${id}-q`,
          type: 'question_select' as const,
          variant: 'mcq' as const,
          prompt: inlineRich(prompt),
          hint: inlineRich(''),
          solution: inlineRich(''),
          fullSolution: inlineRich(''),
          answer: {
            multiSelect: false,
            options,
            correctOptionIds: ['opt-c'],
          },
        },
      ],
    },
  }
}

describe('exerciseWithSectionsToCanonical', () => {
  it('produces one canonical section per Payload section', () => {
    const exercise = { id: 'ex-1', content: { blocks: [] } }
    const sections = [
      mcqSection('sec-1', 'מה 1+1?', '2', ['3']),
      mcqSection('sec-2', 'מה 2+2?', '4', ['5']),
    ]
    const result = exerciseWithSectionsToCanonical(exercise, sections, 0)
    expect(result.exercise.exercise_content.sections).toHaveLength(2)
    expect(result.exercise.exercise_content.sections[0].question_number).toBe('א')
    expect(result.exercise.exercise_content.sections[1].question_number).toBe('ב')
    expect(result.exercise.exercise_content.sections[0].question.text).toBe('מה 1+1?')
    expect(result.exercise.exercise_content.sections[0].correct_option.text).toBe('2')
  })

  it('round-trips exercise + sections through serializer + parser', () => {
    const exercise = {
      id: 'ex-1',
      content: {
        blocks: [richText('intro', 'הקדמה לתרגיל.')],
      },
    }
    const sections = [
      mcqSection('sec-1', 'מה הערך של x?', '5', ['3', '7']),
      {
        id: 'sec-2',
        content: {
          blocks: [
            richText('sec2-intro', 'עכשיו שאלה פתוחה.'),
            {
              id: 'sec2-q',
              type: 'question_free_response' as const,
              prompt: inlineRich('הסבירו את התשובה.'),
              hint: inlineRich(''),
              solution: inlineRich(''),
              fullSolution: inlineRich('התשובה היא 5 כי משוואה שקולה.'),
              answer: { expectedAnswer: inlineRich('') },
            },
          ],
        },
      },
    ]

    const canonical = buildCanonicalLessonExport(
      { title: 'משוואות', order: 1 },
      [exercise],
      'כיתה ח',
      new Map([['ex-1', sections]]),
    )
    const text = serializeLessonToText(canonical)

    expect(text).toContain('[ תרגיל 1 - סעיף א - Single Choice ]')
    expect(text).toContain('[ תרגיל 1 - סעיף ב - Open Ended ]')
    expect(text).toContain('* הנחיה: מה הערך של x?')
    expect(text).toContain('* פתרון מלא: התשובה היא 5 כי משוואה שקולה.')
    // Exercise-level intro appears before the first section
    expect(text.indexOf('הקדמה לתרגיל')).toBeLessThan(text.indexOf('סעיף א'))
    // Section-level intro is prepended to the question text.
    expect(text).toContain('עכשיו שאלה פתוחה')
    expect(text).toContain('הסבירו את התשובה.')

    const parsed = parseTextLessonV2(text)
    expect(parsed.exercises).toHaveLength(1)
    expect(parsed.exercises[0].sections).toHaveLength(2)
    expect(parsed.exercises[0].sections[0].question).toBe('מה הערך של x?')
    expect(parsed.exercises[0].sections[0].options.map((o) => o.text)).toEqual(['5', '3', '7'])
    expect(parsed.exercises[0].sections[1].question).toContain('עכשיו שאלה פתוחה')
    expect(parsed.exercises[0].sections[1].question).toContain('הסבירו את התשובה.')
    expect(parsed.exercises[0].sections[1].fullSolution).toBe('התשובה היא 5 כי משוואה שקולה.')
  })

  it('falls back to legacy inline-question path when no sections are provided', () => {
    // Legacy-style exercise: question block lives directly in exercise.content.blocks
    const legacyExercise = {
      id: 'ex-legacy',
      content: {
        blocks: [
          {
            id: 'leg-q',
            type: 'question_free_response' as const,
            prompt: inlineRich('שאלה ישירה.'),
            hint: inlineRich(''),
            solution: inlineRich(''),
            fullSolution: inlineRich('תשובה.'),
            answer: { expectedAnswer: inlineRich('') },
          },
        ],
      },
    }

    const canonical = buildCanonicalLessonExport(
      { title: 'Legacy', order: 1 },
      [legacyExercise],
      '',
      // No sections map at all — forces the legacy path
    )

    expect(canonical.exercises[0].exercise_content.sections).toHaveLength(1)
    expect(canonical.exercises[0].exercise_content.sections[0].question.text).toBe('שאלה ישירה.')
  })
})
