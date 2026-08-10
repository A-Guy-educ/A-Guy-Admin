import { describe, expect, it } from 'vitest'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { convertTextExerciseToSections } from '@/server/services/text-lesson-import/convert-text-exercise'
import { parseTextLesson } from '@/server/services/text-lesson-import/parse-text'

const SEP_EQ = '='.repeat(80)
const SEP_DASH = '-'.repeat(80)

const FUNCTION_DSL = [
  '%%%',
  '$f(x) = x^2$',
  'color: #3366cc',
  'style: solid',
  'width: 2',
  '%%%',
  'x:[-3,3]',
  'y:[0,9]',
  '%%%',
  'grid: true',
  '%%%',
].join('\n')

describe('parseTextLesson — <function> tag support', () => {
  it('captures a function block at the exercise level without leaking into intro', () => {
    const source = [
      SEP_EQ,
      'תרגיל 1 – מנחה: פרבולה',
      SEP_EQ,
      'נלמד על פרבולות.',
      '<function>',
      FUNCTION_DSL,
      '</function>',
      '',
      SEP_DASH,
      '[תרגיל 1 - סעיף א]',
      SEP_DASH,
      '* תוכן השאלה: מהו f(2)?',
      '* אופציות:',
      '  - 4',
      '  - 6',
      '* פתרון נכון: 4',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
      '',
    ].join('\n')

    const lesson = parseTextLesson(source)
    const ex = lesson.exercises[0]

    expect(ex.function).toBe(FUNCTION_DSL)
    // Narrative must NOT contain the function DSL — otherwise the raw
    // `%%%` markup would end up rendered as intro text.
    expect(ex.intro).toBe('נלמד על פרבולות.')
    expect(ex.intro).not.toContain('%%%')
    expect(ex.intro).not.toContain('$f(x)')
  })

  it('captures a function block inside a section without corrupting the previous field', () => {
    const source = [
      SEP_EQ,
      'תרגיל 1 – מנחה: פרבולה',
      SEP_EQ,
      '',
      SEP_DASH,
      '[תרגיל 1 - סעיף א]',
      SEP_DASH,
      '* תוכן השאלה: מהו הערך של f בנקודה שבתרשים?',
      '<function>',
      FUNCTION_DSL,
      '</function>',
      '* אופציות:',
      '  - 4',
      '  - 6',
      '* פתרון נכון: 4',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
      '',
    ].join('\n')

    const lesson = parseTextLesson(source)
    const section = lesson.exercises[0].sections[0]

    expect(section.function).toBe(FUNCTION_DSL)
    expect(section.question).toBe('מהו הערך של f בנקודה שבתרשים?')
    expect(section.question).not.toContain('%%%')
    expect(section.options).toEqual(['4', '6'])
    expect(section.correctAnswer).toBe('4')
  })

  it('converts the parsed function into a question_axis block that survives ContentSchema', () => {
    const source = [
      SEP_EQ,
      'תרגיל 1 – מנחה: פרבולה',
      SEP_EQ,
      'נלמד על פרבולות.',
      '<function>',
      FUNCTION_DSL,
      '</function>',
      '',
      SEP_DASH,
      '[תרגיל 1 - סעיף א]',
      SEP_DASH,
      '* תוכן השאלה: מהו f(2)?',
      '<function>',
      FUNCTION_DSL,
      '</function>',
      '* אופציות:',
      '  - 4',
      '  - 6',
      '* פתרון נכון: 4',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
      '',
    ].join('\n')

    const lesson = parseTextLesson(source)
    const converted = convertTextExerciseToSections(lesson.exercises[0])

    // Shared block layout: rich_text (intro) → question_axis (function).
    expect(converted.sharedBlocks.map((b) => b.type)).toEqual(['rich_text', 'question_axis'])
    // Section layout: question_axis (from function) → question_select (MCQ).
    expect(converted.sections[0].blocks.map((b) => b.type)).toEqual([
      'question_axis',
      'question_select',
    ])

    // Both block streams must validate against the Payload content schema,
    // otherwise the importer would roll the whole lesson back at insert time.
    expect(() => ContentSchema.parse({ blocks: converted.sharedBlocks })).not.toThrow()
    expect(() => ContentSchema.parse({ blocks: converted.sections[0].blocks })).not.toThrow()
  })
})
