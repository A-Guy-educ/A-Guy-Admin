import { describe, expect, it } from 'vitest'

import { parseTextLesson } from '@/server/services/text-lesson-import/parse-text'

const SEP_EQ = '='.repeat(80)
const SEP_DASH = '-'.repeat(80)

describe('parseTextLesson — section-scoped SVG', () => {
  it('captures an SVG that appears inside a section without leaking it into the question', () => {
    const source = [
      SEP_EQ,
      'תרגיל 1 – מנחה: היקף',
      SEP_EQ,
      'ילדים יקרים, בואו נחשב היקף.',
      '',
      SEP_DASH,
      '[תרגיל 1 - סעיף א]',
      SEP_DASH,
      '* תוכן השאלה: מהו ההיקף של המלבן?',
      '<svg width="250" height="150" xmlns="http://www.w3.org/2000/svg">',
      '  <rect x="25" y="25" width="200" height="100" fill="#f9f9f9"/>',
      '  <text x="110" y="15">4</text>',
      '</svg>',
      '* אופציות:',
      '  - 14',
      '  - 7',
      '* פתרון נכון: 14',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
      '',
    ].join('\n')

    const lesson = parseTextLesson(source)

    expect(lesson.exercises).toHaveLength(1)
    const exercise = lesson.exercises[0]
    // The exercise itself has no SVG — only the section does.
    expect(exercise.svg).toBeUndefined()
    expect(exercise.sections).toHaveLength(1)

    const section = exercise.sections[0]
    expect(section.question).toBe('מהו ההיקף של המלבן?')
    // Question text must NOT contain the raw SVG markup.
    expect(section.question).not.toContain('<svg')
    expect(section.question).not.toContain('<rect')
    expect(section.svg).toBeDefined()
    expect(section.svg).toContain('<svg')
    expect(section.svg).toContain('<rect')
    expect(section.svg).toContain('</svg>')
    expect(section.options).toEqual(['14', '7'])
    expect(section.correctAnswer).toBe('14')
  })

  it('still parses subsequent fields after a section-scoped SVG closes', () => {
    const source = [
      SEP_EQ,
      'תרגיל 1 – מנחה: שטח',
      SEP_EQ,
      '',
      SEP_DASH,
      '[תרגיל 1 - סעיף א]',
      SEP_DASH,
      '* תוכן השאלה: מהו השטח?',
      '<svg><rect/></svg>',
      '* אופציות:',
      '  - 20',
      '  - 18',
      '* פתרון נכון: 20',
      '* רמז: כפלו את האורך ברוחב.',
      '* פתרון מלא: 5 כפול 4 שווה 20.',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
    ].join('\n')

    const lesson = parseTextLesson(source)
    const section = lesson.exercises[0].sections[0]

    expect(section.svg).toBe('<svg><rect/></svg>')
    expect(section.hint).toBe('כפלו את האורך ברוחב.')
    expect(section.fullSolution).toBe('5 כפול 4 שווה 20.')
    expect(section.correctAnswer).toBe('20')
  })

  it('keeps exercise-level SVG intact when the section does not carry its own', () => {
    const source = [
      SEP_EQ,
      'תרגיל 1 – מנחה: היקף',
      SEP_EQ,
      'הקדמה.',
      '<svg id="shared"><rect/></svg>',
      '',
      SEP_DASH,
      '[תרגיל 1 - סעיף א]',
      SEP_DASH,
      '* תוכן השאלה: שאלה?',
      '* אופציות:',
      '  - א',
      '  - ב',
      '* פתרון נכון: א',
      '* סוג תרגיל: בחירה בין 2 אפשרויות',
    ].join('\n')

    const lesson = parseTextLesson(source)
    const exercise = lesson.exercises[0]

    expect(exercise.svg).toBe('<svg id="shared"><rect/></svg>')
    expect(exercise.sections[0].svg).toBeUndefined()
  })
})
