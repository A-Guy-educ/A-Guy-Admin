import { describe, expect, it } from 'vitest'

import { compactBlock, expandBlock } from '@/server/services/lesson-full-json/compact-blocks'
import { stringifyLessonFile } from '@/server/services/lesson-full-json/stringify-lesson-file'

function inline(value: string, mediaIds: string[] = []) {
  return { type: 'rich_text', format: 'md-math-v1', value, mediaIds }
}

function withoutId({ id: _id, ...rest }: Record<string, unknown>) {
  return rest
}

const mcq = {
  id: 'b1',
  type: 'question_select',
  variant: 'mcq',
  selectionMode: 'single',
  prompt: inline('איזו צלע היא היתר?'),
  answer: {
    multiSelect: false,
    options: [
      { id: 'opt-1', content: inline('$$AB$$') },
      { id: 'opt-2', content: inline('$$AC$$') },
    ],
    correctOptionIds: ['opt-2'],
  },
  fullSolution: inline('היתר מול הזווית הישרה.'),
}

const trueFalse = {
  id: 'b2',
  type: 'question_select',
  variant: 'true_false',
  selectionMode: 'single',
  prompt: inline('2+2=4?'),
  options: [
    { id: 'true', value: true, label: inline('נכון') },
    { id: 'false', value: false, label: inline('לא נכון') },
  ],
  answer: { correctOptionId: 'true' },
}

const matching = {
  id: 'b3',
  type: 'question_matching',
  prompt: inline('התאימו'),
  leftColumn: [
    { id: 'l1', content: inline('$$3^2$$') },
    { id: 'l2', content: inline('$$4^2$$') },
  ],
  rightColumn: [
    { id: 'r1', content: inline('9') },
    { id: 'r2', content: inline('16') },
  ],
  correctPairs: [{ optionId: 'l1', matchId: 'r1' }],
  shuffleRightColumn: true,
}

// Plain strings that are not rich text (point labels, axis labels) must stay strings.
const axis = {
  id: 'b4',
  type: 'question_axis',
  prompt: inline(''),
  layout: 'textLeft',
  displaySize: 'small',
  axis: {
    kind: 'cartesian',
    units: 1,
    grid: { enabled: false },
    axes: {
      showNumbers: true,
      showLabels: false,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    viewportMode: 'manual',
    viewport: { xMin: 0, xMax: 6, yMin: -0.5, yMax: 5.5 },
    elements: {
      points: [{ x: 1, y: 4, type: 'point', color: 'black', label: 'A(1,4)' }],
      graphs: [],
    },
  },
}

const textBlock = { id: 'b5', ...inline('נתון מלבן $$ABCD$$') }

describe('compactBlock', () => {
  it('drops the id and turns rich text into plain strings', () => {
    expect(compactBlock(mcq)).toEqual({
      type: 'question_select',
      variant: 'mcq',
      selectionMode: 'single',
      prompt: 'איזו צלע היא היתר?',
      answer: {
        multiSelect: false,
        options: [
          { id: 'opt-1', content: '$$AB$$' },
          { id: 'opt-2', content: '$$AC$$' },
        ],
        correctOptionIds: ['opt-2'],
      },
      fullSolution: 'היתר מול הזווית הישרה.',
    })
  })

  it('turns a rich_text block into a bare string', () => {
    expect(compactBlock(textBlock)).toBe('נתון מלבן $$ABCD$$')
  })

  it('keeps rich text that carries media as a full object', () => {
    const block = { ...mcq, prompt: inline('ראו תמונה', ['m-1']) }
    expect((compactBlock(block) as Record<string, unknown>).prompt).toEqual(
      inline('ראו תמונה', ['m-1']),
    )
  })

  it('falls back to the full block when a field would not expand back', () => {
    // Rich text under a key the schema doesn't know can't be safely re-wrapped.
    const block = { ...mcq, extra: inline('x') }
    expect(compactBlock(block)).toEqual(withoutId(block))
  })
})

describe('expandBlock', () => {
  it.each([
    ['mcq', mcq],
    ['true_false (tuple options)', trueFalse],
    ['matching (nested arrays)', matching],
    ['axis (non-rich-text strings)', axis],
    ['rich_text block', textBlock],
  ])('round-trips %s exactly', (_name, block) => {
    const compact = JSON.parse(JSON.stringify(compactBlock(block)))
    expect(JSON.stringify(compact)).not.toContain('"rich_text"')
    expect(expandBlock(compact)).toEqual(withoutId(block))
  })

  it('leaves full (v1) blocks unchanged', () => {
    expect(expandBlock(withoutId(mcq))).toEqual(withoutId(mcq))
  })

  it('wraps strings an LLM writes into rich text fields', () => {
    const added = {
      type: 'question_free_response',
      prompt: 'כמה?',
      answer: { acceptedAnswers: ['5'] },
    }
    expect(expandBlock(added)).toEqual({ ...added, prompt: inline('כמה?') })
  })
})

describe('stringifyLessonFile', () => {
  it('keeps short values on one line and stays valid JSON', () => {
    const value = { blocks: [compactBlock(mcq), compactBlock(axis)] }
    const text = stringifyLessonFile(value)
    expect(JSON.parse(text)).toEqual(value)
    expect(text).toContain('{"id":"opt-1","content":"$$AB$$"}')
    expect(text.split('\n').every((line) => line.length <= 140)).toBe(true)
  })
})
