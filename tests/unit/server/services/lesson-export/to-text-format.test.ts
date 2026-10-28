import { describe, expect, it } from 'vitest'

import type {
  QuestionMatchingBlock,
  QuestionSelectMcqBlock,
  QuestionTableBlock,
} from '@/server/payload/collections/Exercises/types'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import {
  buildCanonicalLessonExport,
  type CanonicalLessonExport,
} from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'
import { convertTextExerciseV2ToSections } from '@/server/services/text-lesson-import/convert-text-exercise-v2'
import { isV2Format, parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'

const empty = { text: '', table: null as null, PNG: '', svg: '' }

function fromText(text: string) {
  return { text, table: null as null, PNG: '', svg: '' }
}

function inline(value: string) {
  return { type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

function singleSectionLesson(
  section: Partial<CanonicalLessonExport['exercises'][0]['exercise_content']['sections'][0]>,
  data = empty,
): CanonicalLessonExport {
  return {
    class: '',
    lesson_number: '1',
    topic: 'Test',
    exercises: [
      {
        exercise_number: '1',
        level: '1',
        exercise_content: {
          data,
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
              ...section,
            },
          ],
        },
      },
    ],
    meta: { renderedSvgCount: 0, renderFailures: [] },
  }
}

/** Export a single section doc through the real canonical builder + serializer. */
function exportSectionBlocks(blocks: unknown[]): string {
  const canonical = buildCanonicalLessonExport(
    { title: 'Export Test Lesson', order: 1 },
    [{ id: 'ex-1', content: { blocks: [] } }],
    '',
    new Map([['ex-1', [{ id: 'sec-1', content: { blocks } }]]]),
  )
  return serializeLessonToText(canonical)
}

function reimportFirstBlock(text: string) {
  const parsed = parseTextLessonV2(text)
  expect(parsed.exercises).toHaveLength(1)
  const converted = convertTextExerciseV2ToSections(parsed.exercises[0])
  expect(converted.sections).toHaveLength(1)
  return converted.sections[0].blocks[0]
}

const sampleGeometry: GeometrySpecV1 = {
  kind: 'euclidean',
  canvas: { width: 400, height: 400 },
  elements: {
    points: [
      { name: 'A', x: 90, y: 325, position: 'bl' },
      { name: 'B', x: 310, y: 270, position: 'br' },
      { name: 'C', x: 310, y: 75, position: 'tr' },
      { name: 'D', x: 90, y: 130, position: 'tl' },
      { name: 'E', x: 200, y: 200, position: 'r' },
    ],
    lines: [
      { from: 'A', to: 'E', style: 'solid' },
      { from: 'E', to: 'C', style: 'solid' },
      { from: 'B', to: 'E', style: 'solid' },
      { from: 'E', to: 'D', style: 'solid' },
    ],
    circles: [],
    angles: [],
  },
}

describe('serializeLessonToText', () => {
  it('emits v2 headers and MCQ options with the correct marker', () => {
    const text = serializeLessonToText(
      singleSectionLesson({
        question: fromText('מה הערך של x?'),
        correct_option: fromText('5'),
        wrong_options: [fromText('3'), fromText('7')],
      }),
    )

    expect(isV2Format(text)).toBe(true)
    expect(text).toContain('שם השיעור - Test')
    expect(text).toContain('[ תרגיל 1 - נתוני פתיחה ]')
    expect(text).toContain('[ תרגיל 1 - סעיף א - Single Choice ]')
    expect(text).toContain('* הנחיה: מה הערך של x?')
    expect(text).toContain('* אפשרות 1: 5 [תשובה נכונה]')
    expect(text).toContain('* אפשרות 2: 3')

    const parsed = parseTextLessonV2(text)
    const section = parsed.exercises[0].sections[0]
    expect(section.question).toBe('מה הערך של x?')
    expect(section.options).toEqual([
      { text: '5', correct: true },
      { text: '3', correct: false },
      { text: '7', correct: false },
    ])
  })

  it('emits multi-line solutions as continuation lines the parser re-joins', () => {
    const text = serializeLessonToText(
      singleSectionLesson({ full_solution: fromText('Step 1\nStep 2\nStep 3') }),
    )
    expect(text).toContain('* פתרון מלא: Step 1\nStep 2\nStep 3')

    const section = parseTextLessonV2(text).exercises[0].sections[0]
    expect(section.fullSolution).toBe('Step 1\nStep 2\nStep 3')
    expect(section.options).toEqual([])
  })

  it('emits a standalone section SVG under the standalone sketch marker', () => {
    const svg = '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"></svg>'
    const text = serializeLessonToText(
      singleSectionLesson({
        section_data: { text: '', table: null, PNG: '', svg },
        question: fromText('What shape?'),
      }),
    )
    expect(text).toContain('* שרטוט עצמאי לסעיף:')
    expect(text).not.toContain('* שרטוט מותאם לסעיף:')

    const section = parseTextLessonV2(text).exercises[0].sections[0]
    expect(section.standaloneSvg).toContain('<svg')
    expect(section.svg).toBeUndefined()
    expect(section.question).toBe('What shape?')
  })

  it('emits a question-attached SVG under the section sketch marker', () => {
    const svg = '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"></svg>'
    const text = serializeLessonToText(
      singleSectionLesson({ question: { text: 'What shape?', table: null, PNG: '', svg } }),
    )
    expect(text).toContain('* שרטוט מותאם לסעיף:')

    const section = parseTextLessonV2(text).exercises[0].sections[0]
    expect(section.svg).toContain('<svg')
    expect(section.standaloneSvg).toBeUndefined()
  })

  it('round-trips a standalone svg block followed by a question without attaching it', () => {
    const svg = '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"></svg>'
    const text = exportSectionBlocks([
      { id: 's1', type: 'svg', value: svg },
      {
        id: 'q1',
        type: 'question_free_response',
        prompt: inline('Find AC'),
        answer: { acceptedAnswers: ['5'] },
      },
    ])
    const converted = convertTextExerciseV2ToSections(parseTextLessonV2(text).exercises[0])
    const blocks = converted.sections[0].blocks as Array<{ type: string; attachment?: unknown }>
    expect(blocks.map((b) => b.type)).toEqual(['svg', 'question_free_response'])
    expect(blocks[1].attachment).toBeUndefined()
  })

  it('round-trips a question svg attachment as an attachment', () => {
    const svg = '<svg width="10" height="10" xmlns="http://www.w3.org/2000/svg"></svg>'
    const text = exportSectionBlocks([
      {
        id: 'q1',
        type: 'question_free_response',
        prompt: inline('Find AC'),
        answer: { acceptedAnswers: ['5'] },
        attachment: { kind: 'svg', layout: 'textRight', svg: { value: svg } },
      },
    ])
    const block = reimportFirstBlock(text) as { type: string; attachment?: { kind: string } }
    expect(block.type).toBe('question_free_response')
    expect(block.attachment?.kind).toBe('svg')
  })

  it('omits empty hint, solution, and options fields entirely', () => {
    const text = serializeLessonToText(singleSectionLesson({}))
    expect(text).toContain('* סוג השאלה: Open Ended')
    expect(text).not.toContain('* רמז')
    expect(text).not.toContain('* פתרון מלא')
    expect(text).not.toContain('* אפשרות')
  })

  it('emits exercise intro text before sections', () => {
    const text = serializeLessonToText(
      singleSectionLesson({}, fromText('לפניכם משוואה. פתרו אותה.')),
    )
    expect(text.indexOf('* טקסט: לפניכם משוואה')).toBeLessThan(text.indexOf('סעיף א'))
    expect(parseTextLessonV2(text).exercises[0].intro).toContain('לפניכם משוואה')
  })
})

describe('export → import round-trip', () => {
  it('fill-in table with a geometry attachment', () => {
    const tableBlock: QuestionTableBlock = {
      id: 'q-table',
      type: 'question_table',
      prompt: inline('השלימו את התאים החסרים.'),
      table: {
        solutionFill: true,
        headers: ['שלב', 'טענה', 'נימוק'],
        rowsData: [
          ['1', 'AE=CE', 'נתון'],
          ['2', 'BE=DE', ''],
          ['3', '', 'זוויות קודקודיות שוות'],
        ],
        answers: { '1-2': 'נתון', '2-1': 'זווית AEB = זווית CED' },
        showBorders: true,
        showHeader: true,
      },
      attachment: { kind: 'geometry', layout: 'textRight', geometry: sampleGeometry },
      hint: inline('חפשו זוויות קודקודיות.'),
      fullSolution: inline('AE=CE — נתון.\nBE=DE — נתון.'),
    }

    const text = exportSectionBlocks([tableBlock])
    expect(text).toContain('* סוג השאלה: Fill-in Table')
    expect(text).toContain('* מבנה טבלה (עמודות: שלב, טענה, נימוק):')
    expect(text).toContain('[ שדה ריק - להשלמה: נתון ]')

    const block = reimportFirstBlock(text) as QuestionTableBlock
    expect(block.type).toBe('question_table')
    expect(block.table.headers).toEqual(['שלב', 'טענה', 'נימוק'])
    expect(block.table.rowsData).toEqual([
      ['1', 'AE=CE', 'נתון'],
      ['2', 'BE=DE', ''],
      ['3', '', 'זוויות קודקודיות שוות'],
    ])
    expect(block.table.answers).toEqual({ '1-2': 'נתון', '2-1': 'זווית AEB = זווית CED' })
    expect(block.hint?.value).toBe('חפשו זוויות קודקודיות.')
    expect(block.fullSolution?.value).toBe('AE=CE — נתון.\nBE=DE — נתון.')

    expect(block.attachment?.kind).toBe('geometry')
    const geometry = (block.attachment as { geometry: GeometrySpecV1 }).geometry
    expect(geometry.elements.points.map((p) => [p.name, p.x, p.y])).toEqual(
      sampleGeometry.elements.points.map((p) => [p.name, p.x, p.y]),
    )
    expect(geometry.elements.lines.map((l) => `${l.from}${l.to}`)).toEqual(['AE', 'EC', 'BE', 'ED'])
  })

  it('multiple-choice keeps every correct option', () => {
    const mcq: QuestionSelectMcqBlock = {
      id: 'q-mcq',
      type: 'question_select',
      variant: 'mcq',
      selectionMode: 'multiple',
      prompt: inline('אילו נכונות?'),
      answer: {
        multiSelect: true,
        options: [
          { id: 'o1', content: inline('א') },
          { id: 'o2', content: inline('ב') },
          { id: 'o3', content: inline('ג') },
        ],
        correctOptionIds: ['o1', 'o3'],
      },
    }

    const block = reimportFirstBlock(exportSectionBlocks([mcq])) as QuestionSelectMcqBlock
    expect(block.selectionMode).toBe('multiple')
    const correct = block.answer.options
      .filter((o) => block.answer.correctOptionIds.includes(o.id))
      .map((o) => o.content.value)
      .sort()
    expect(correct).toEqual(['א', 'ג'])
  })

  it('matching pairs', () => {
    const matching: QuestionMatchingBlock = {
      id: 'q-match',
      type: 'question_matching',
      prompt: inline('התאימו.'),
      leftColumn: [
        { id: 'l1', content: inline('קטע AB') },
        { id: 'l2', content: inline('קטע CD') },
      ],
      rightColumn: [
        { id: 'r1', content: inline('משיק') },
        { id: 'r2', content: inline('קוטר') },
      ],
      correctPairs: [
        { optionId: 'l1', matchId: 'r1' },
        { optionId: 'l2', matchId: 'r2' },
      ],
    }

    const block = reimportFirstBlock(exportSectionBlocks([matching])) as QuestionMatchingBlock
    expect(block.type).toBe('question_matching')
    const left = new Map(block.leftColumn.map((o) => [o.id, o.content.value]))
    const right = new Map(block.rightColumn.map((o) => [o.id, o.content.value]))
    const pairs = block.correctPairs.map((p) => [left.get(p.optionId), right.get(p.matchId)])
    expect(pairs).toEqual([
      ['קטע AB', 'משיק'],
      ['קטע CD', 'קוטר'],
    ])
  })
})
