import { describe, expect, it } from 'vitest'

import type {
  QuestionAxisBlock,
  QuestionSelectMcqBlock,
} from '@/server/payload/collections/Exercises/types'
import { buildCanonicalLessonExport } from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'
import { convertTextExerciseV2ToSections } from '@/server/services/text-lesson-import/convert-text-exercise-v2'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'

function inline(value: string) {
  return { type: 'rich_text' as const, format: 'md-math-v1' as const, value, mediaIds: [] }
}

const SKETCH_TEXT =
  'נתון משולש ABC במערכת צירים.\r\n\r\nהקטע AB מקביל לציר ה־x.\r\n\r\n$$A(1,1),\\quad B(5,1)$$\n'

function axisBlock(prompt: string): QuestionAxisBlock {
  return {
    id: 'axis-1',
    type: 'question_axis',
    prompt: inline(prompt),
    layout: 'textRight',
    axis: {
      kind: 'cartesian',
      units: 1,
      grid: { enabled: true },
      axes: {
        showNumbers: true,
        showLabels: false,
        ticks: 1,
        labels: { x: 'x', y: 'y' },
        origin: { x: 0, y: 0 },
      },
      viewportMode: 'manual',
      viewport: { xMin: -1, xMax: 7, yMin: -2, yMax: 6 },
      elements: {
        points: [{ x: 1, y: 1, type: 'point', label: 'A' }],
        graphs: [],
        lineBetweenPoints: [{ style: 'solid', thickness: 2, a: { x: 1, y: 1 }, b: { x: 5, y: 1 } }],
      },
    },
    displaySize: 'full',
  }
}

const mcq: QuestionSelectMcqBlock = {
  id: 'q-mcq',
  type: 'question_select',
  variant: 'mcq',
  selectionMode: 'single',
  prompt: inline('מה אורך AB?'),
  answer: {
    multiSelect: false,
    options: [
      { id: 'o1', content: inline('4') },
      { id: 'o2', content: inline('6') },
    ],
    correctOptionIds: ['o1'],
  },
}

function roundTrip(exerciseBlocks: unknown[], sectionBlocks: unknown[]) {
  const canonical = buildCanonicalLessonExport(
    { title: 'Sketch text', order: 1 },
    [{ id: 'ex-1', content: { blocks: exerciseBlocks } }],
    '',
    new Map([['ex-1', [{ id: 'sec-1', content: { blocks: sectionBlocks } }]]]),
  )
  const text = serializeLessonToText(canonical)
  const converted = convertTextExerciseV2ToSections(parseTextLessonV2(text).exercises[0])
  return { text, converted }
}

const expectedText = SKETCH_TEXT.replace(/\r\n/g, '\n').trim()

describe('sketch blocks with text round-trip', () => {
  it('keeps the text on an exercise-level axis block, paragraphs included', () => {
    const { text, converted } = roundTrip([axisBlock(SKETCH_TEXT)], [mcq])
    expect(text).toContain('* טקסט שרטוט: נתון משולש ABC')

    expect(converted.sharedBlocks).toHaveLength(1)
    const axis = converted.sharedBlocks[0] as QuestionAxisBlock
    expect(axis.type).toBe('question_axis')
    expect(axis.prompt.value).toBe(expectedText)
    expect(axis.axis.elements.lineBetweenPoints).toHaveLength(1)
  })

  it('keeps a section MCQ when a texted sketch precedes it', () => {
    const { converted } = roundTrip([], [axisBlock(SKETCH_TEXT), mcq])
    const blocks = converted.sections[0].blocks
    expect(blocks.map((b) => b.type)).toEqual(['question_axis', 'question_select'])
    expect((blocks[0] as QuestionAxisBlock).prompt.value).toBe(expectedText)
    expect((blocks[1] as QuestionSelectMcqBlock).prompt.value).toContain('מה אורך AB?')
  })

  it('still treats a lone texted sketch in a section as the question', () => {
    const { converted } = roundTrip([], [axisBlock('מצאו את AB')])
    const blocks = converted.sections[0].blocks as Array<{
      type: string
      prompt?: { value: string }
    }>
    expect(blocks.at(-1)?.prompt?.value).toContain('מצאו את AB')
  })
})
