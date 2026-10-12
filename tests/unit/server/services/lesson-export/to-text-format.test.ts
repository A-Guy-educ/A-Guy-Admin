import { describe, expect, it } from 'vitest'

import type { CanonicalLessonExport } from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToV1Text } from '@/server/services/lesson-export/to-text-format'
import { parseTextLesson } from '@/server/services/text-lesson-import/parse-text'

const empty = { text: '', table: null as null, PNG: '', svg: '' }

function fromText(text: string) {
  return { text, table: null as null, PNG: '', svg: '' }
}

describe('serializeLessonToV1Text', () => {
  it('emits lesson header and renders MCQ options with correct option first', () => {
    const canonical: CanonicalLessonExport = {
      class: 'כיתה ח',
      lesson_number: '1',
      topic: 'משוואות ממעלה ראשונה',
      exercises: [
        {
          exercise_number: '1',
          level: '1',
          exercise_content: {
            data: empty,
            sections: [
              {
                section_data: empty,
                question_number: 'א',
                question: fromText('מה הערך של x?'),
                hint: empty,
                solution: empty,
                full_solution: empty,
                correct_option: fromText('5'),
                wrong_options: [fromText('3'), fromText('7')],
              },
            ],
          },
        },
      ],
      meta: { renderedSvgCount: 0, renderFailures: [] },
    }

    const text = serializeLessonToV1Text(canonical)

    expect(text).toContain('שם השיעור - משוואות ממעלה ראשונה')
    expect(text).toContain('קורס - כיתה ח')
    expect(text).toContain('תרגיל 1')
    expect(text).toContain('[תרגיל 1 - סעיף א]')
    expect(text).toContain('* תוכן השאלה: מה הערך של x?')
    // Correct option listed first under אופציות, then wrong options, then פתרון נכון
    const optionsBlock = text.slice(text.indexOf('* אופציות:'))
    expect(optionsBlock.indexOf('  - 5')).toBeLessThan(optionsBlock.indexOf('  - 3'))
    expect(optionsBlock.indexOf('  - 3')).toBeLessThan(optionsBlock.indexOf('  - 7'))
    expect(text).toContain('* פתרון נכון: 5')

    // Round-trips through the v1 parser
    const parsed = parseTextLesson(text)
    expect(parsed.exercises).toHaveLength(1)
    expect(parsed.exercises[0].sections).toHaveLength(1)
    expect(parsed.exercises[0].sections[0].question).toBe('מה הערך של x?')
    expect(parsed.exercises[0].sections[0].options).toEqual(['5', '3', '7'])
    expect(parsed.exercises[0].sections[0].correctAnswer).toBe('5')
  })

  it('emits multi-line solutions as continuation lines the parser re-joins', () => {
    const canonical: CanonicalLessonExport = {
      class: '',
      lesson_number: '1',
      topic: 'Test',
      exercises: [
        {
          exercise_number: '1',
          level: '1',
          exercise_content: {
            data: empty,
            sections: [
              {
                section_data: empty,
                question_number: 'א',
                question: fromText('Q?'),
                hint: empty,
                solution: empty,
                full_solution: fromText('Step 1\nStep 2\nStep 3'),
                correct_option: empty,
                wrong_options: [],
              },
            ],
          },
        },
      ],
      meta: { renderedSvgCount: 0, renderFailures: [] },
    }

    const text = serializeLessonToV1Text(canonical)
    expect(text).toContain('* פתרון מלא: Step 1')
    expect(text).toContain('\nStep 2\n')
    expect(text).toContain('\nStep 3')

    const parsed = parseTextLesson(text)
    expect(parsed.exercises[0].sections[0].fullSolution).toBe('Step 1\nStep 2\nStep 3')
    // Non-MCQ section with no options
    expect(parsed.exercises[0].sections[0].options).toEqual([])
  })

  it('inlines a section-level SVG under the section header', () => {
    const svg = '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"></svg>'
    const canonical: CanonicalLessonExport = {
      class: '',
      lesson_number: '1',
      topic: 'Geo',
      exercises: [
        {
          exercise_number: '1',
          level: '1',
          exercise_content: {
            data: empty,
            sections: [
              {
                section_data: { text: '', table: null, PNG: '', svg },
                question_number: 'א',
                question: fromText('What shape?'),
                hint: empty,
                solution: empty,
                full_solution: empty,
                correct_option: empty,
                wrong_options: [],
              },
            ],
          },
        },
      ],
      meta: { renderedSvgCount: 1, renderFailures: [] },
    }

    const text = serializeLessonToV1Text(canonical)
    const headerIdx = text.indexOf('[תרגיל 1 - סעיף א]')
    const svgIdx = text.indexOf('<svg')
    const questionIdx = text.indexOf('* תוכן השאלה:')
    expect(headerIdx).toBeGreaterThanOrEqual(0)
    expect(svgIdx).toBeGreaterThan(headerIdx)
    expect(questionIdx).toBeGreaterThan(svgIdx)

    const parsed = parseTextLesson(text)
    expect(parsed.exercises[0].sections[0].svg).toContain('<svg')
    expect(parsed.exercises[0].sections[0].question).toBe('What shape?')
  })

  it('omits empty hint, solution, and options fields entirely', () => {
    const canonical: CanonicalLessonExport = {
      class: '',
      lesson_number: '1',
      topic: 'Minimal',
      exercises: [
        {
          exercise_number: '1',
          level: '1',
          exercise_content: {
            data: empty,
            sections: [
              {
                section_data: empty,
                question_number: 'א',
                question: fromText('Q?'),
                hint: empty,
                solution: empty,
                full_solution: empty,
                correct_option: empty,
                wrong_options: [],
              },
            ],
          },
        },
      ],
      meta: { renderedSvgCount: 0, renderFailures: [] },
    }

    const text = serializeLessonToV1Text(canonical)
    expect(text).not.toContain('* רמז')
    expect(text).not.toContain('* פתרון מלא')
    expect(text).not.toContain('* פתרון נכון')
    expect(text).not.toContain('* אופציות')
  })

  it('emits exercise intro text before sections', () => {
    const canonical: CanonicalLessonExport = {
      class: '',
      lesson_number: '1',
      topic: 'Intro',
      exercises: [
        {
          exercise_number: '1',
          level: '1',
          exercise_content: {
            data: fromText('לפניכם משוואה. פתרו אותה.'),
            sections: [
              {
                section_data: empty,
                question_number: 'א',
                question: fromText('מה הפתרון?'),
                hint: empty,
                solution: empty,
                full_solution: empty,
                correct_option: empty,
                wrong_options: [],
              },
            ],
          },
        },
      ],
      meta: { renderedSvgCount: 0, renderFailures: [] },
    }

    const text = serializeLessonToV1Text(canonical)
    const introIdx = text.indexOf('לפניכם משוואה')
    const sectionIdx = text.indexOf('[תרגיל 1 - סעיף א]')
    expect(introIdx).toBeGreaterThan(-1)
    expect(sectionIdx).toBeGreaterThan(introIdx)

    const parsed = parseTextLesson(text)
    expect(parsed.exercises[0].intro).toContain('לפניכם משוואה')
  })
})
