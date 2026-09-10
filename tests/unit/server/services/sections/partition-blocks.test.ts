import { describe, expect, it } from 'vitest'
import {
  QUESTION_TYPES,
  deriveSectionTitle,
  emptyPlaceholder,
  isQuestion,
  partitionBlocks,
} from '@/server/services/sections/partition-blocks'
import type { ContentBlock, RichTextBlock } from '@/server/payload/collections/Exercises/types'

function richText(value: string): RichTextBlock {
  return {
    id: `rt-${value.slice(0, 6)}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'rich_text',
    format: 'md-math-v1',
    value,
    mediaIds: [],
  }
}

function questionSelect(promptValue: string): ContentBlock {
  return {
    id: `q-${promptValue.slice(0, 6)}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'question_select',
    variant: 'true_false',
    selectionMode: 'single',
    prompt: { type: 'rich_text', format: 'md-math-v1', value: promptValue, mediaIds: [] },
    options: [
      {
        id: 'true',
        value: true,
        label: { type: 'rich_text', format: 'md-math-v1', value: 'True', mediaIds: [] },
      },
      {
        id: 'false',
        value: false,
        label: { type: 'rich_text', format: 'md-math-v1', value: 'False', mediaIds: [] },
      },
    ],
    answer: { correctOptionId: 'true' },
  }
}

function questionFreeResponse(promptValue: string): ContentBlock {
  return {
    id: `qfr-${promptValue.slice(0, 6)}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'question_free_response',
    prompt: { type: 'rich_text', format: 'md-math-v1', value: promptValue, mediaIds: [] },
    answer: { acceptedAnswers: ['4'] },
  }
}

describe('QUESTION_TYPES', () => {
  it('includes the four anchor question types only', () => {
    expect([...QUESTION_TYPES].sort()).toEqual(
      ['question_free_response', 'question_matching', 'question_select', 'question_table'].sort(),
    )
  })
})

describe('isQuestion', () => {
  it.each(['question_select', 'question_free_response', 'question_table', 'question_matching'])(
    'returns true for %s',
    (type) => {
      expect(isQuestion({ type })).toBe(true)
    },
  )

  it.each([
    'question_geometry',
    'question_axis',
    'question_multi_axis',
    'svg',
    'rich_text',
    'latex',
  ])('returns false for %s (not a partition anchor)', (type) => {
    expect(isQuestion({ type })).toBe(false)
  })
})

describe('emptyPlaceholder', () => {
  it('returns a single empty rich_text block', () => {
    const block = emptyPlaceholder()
    expect(block.type).toBe('rich_text')
    expect(block.format).toBe('md-math-v1')
    expect(block.value).toBe('')
    expect(block.mediaIds).toEqual([])
    expect(block.id).toBeTruthy()
  })
})

describe('deriveSectionTitle', () => {
  // Section titles always match the sub-question label the author uses in the
  // source (`\item` inside `\begin{enumerate}[label=\alph*.]`) — see the
  // header comment on `deriveSectionTitle`. The n-th section becomes
  // `סעיף א`, `סעיף ב`, … regardless of the anchor question's prompt.
  it('numbers sections with Hebrew letter labels', () => {
    const q = questionSelect('Solve 2+2')
    expect(deriveSectionTitle([q], 1)).toBe('סעיף א')
    expect(deriveSectionTitle([q], 2)).toBe('סעיף ב')
    expect(deriveSectionTitle([q], 3)).toBe('סעיף ג')
  })

  it('ignores the question prompt when generating the title', () => {
    const longPrompt = 'A'.repeat(80)
    const q = questionSelect(longPrompt)
    expect(deriveSectionTitle([q], 1)).toBe('סעיף א')
  })

  it('falls back to the numeric index when past the Hebrew alphabet range', () => {
    const q = questionSelect('')
    expect(deriveSectionTitle([q], 42)).toBe('סעיף 42')
  })
})

describe('partitionBlocks — flat shape', () => {
  it('returns the whole stream as shared when there are no question blocks', () => {
    const blocks = [richText('Intro'), richText('More text')]
    const result = partitionBlocks(blocks)
    expect(result.isFlat).toBe(true)
    expect(result.sections).toHaveLength(0)
    expect(result.exerciseSharedBlocks).toEqual(blocks)
  })

  it('returns empty shared + no sections for empty input', () => {
    const result = partitionBlocks([])
    expect(result.isFlat).toBe(true)
    expect(result.sections).toHaveLength(0)
    expect(result.exerciseSharedBlocks).toEqual([])
  })
})

describe('partitionBlocks — partitioned shape', () => {
  it('creates one section per question; pre-first-question content hoists to exercise-shared', () => {
    const intro = richText('Read this intro first')
    const q1 = questionSelect('Pick true or false')
    const middle = richText('Some text between questions')
    const q2 = questionFreeResponse('What is 2+2?')

    const result = partitionBlocks([intro, q1, middle, q2])

    expect(result.isFlat).toBe(false)
    expect(result.sections).toHaveLength(2)
    // Pre-first-question content (intro paragraph, top-of-exercise diagram)
    // lives on the exercise as shared context — it renders alongside the
    // right-minipage diagram, not shoved into section א as leading.
    expect(result.exerciseSharedBlocks).toEqual([intro])
    // Section א = [q1 anchor, middle (trailing before q2)].
    expect(result.sections[0].contentBlocks).toEqual([q1, middle])
    expect(result.sections[1].contentBlocks).toEqual([q2])
  })

  it('attaches trailing non-question blocks to the CURRENT section', () => {
    const q1 = questionSelect('First question')
    const q2 = questionFreeResponse('Second question')
    const tail1 = richText('After q2 #1')
    const tail2 = richText('After q2 #2')

    const result = partitionBlocks([q1, q2, tail1, tail2])

    expect(result.sections).toHaveLength(2)
    expect(result.exerciseSharedBlocks).toEqual([])
    expect(result.sections[0].contentBlocks).toEqual([q1])
    // Both tails attach to q2's section (the current section when they
    // arrive), so section 2 = [q2, tail1, tail2].
    expect(result.sections[1].contentBlocks).toEqual([q2, tail1, tail2])
  })

  it('intro hoists to shared; trailing content lands in the only section', () => {
    const intro = richText('Shared intro')
    const q = questionSelect('Only question')
    const tail = richText('Trailing shared text')

    const result = partitionBlocks([intro, q, tail])

    expect(result.exerciseSharedBlocks).toEqual([intro])
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].contentBlocks).toEqual([q, tail])
  })

  it('handles a stream with only question blocks (no shared, no intro)', () => {
    const q1 = questionSelect('Q1')
    const q2 = questionFreeResponse('Q2')
    const result = partitionBlocks([q1, q2])

    expect(result.exerciseSharedBlocks).toEqual([])
    expect(result.sections).toHaveLength(2)
    expect(result.sections[0].contentBlocks).toEqual([q1])
    expect(result.sections[1].contentBlocks).toEqual([q2])
  })

  it('titles each section סעיף א/ב/ג… regardless of question content', () => {
    const q1 = questionSelect('anything')
    const q2 = questionFreeResponse('')
    const q3 = questionSelect('another')
    const result = partitionBlocks([q1, q2, q3])
    expect(result.sections.map((s) => s.title)).toEqual(['סעיף א', 'סעיף ב', 'סעיף ג'])
  })

  it('does not mutate the input blocks array', () => {
    const intro = richText('Intro')
    const q = questionSelect('Question?')
    const blocks = [intro, q]
    const snapshot = blocks.map((b) => ({ ...b }))

    partitionBlocks(blocks)

    expect(blocks).toEqual(snapshot)
  })
})
