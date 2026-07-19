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
  it('uses the first line of the question prompt', () => {
    const q = questionSelect('Solve 2+2')
    const title = deriveSectionTitle([q], 1)
    expect(title).toBe('Solve 2+2')
  })

  it('truncates prompts longer than 60 chars', () => {
    const longPrompt = 'A'.repeat(80)
    const q = questionSelect(longPrompt)
    const title = deriveSectionTitle([q], 1)
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
  })

  it('uses only the first line of multi-line prompts', () => {
    const q = questionSelect('First line\nSecond line\nThird line')
    expect(deriveSectionTitle([q], 1)).toBe('First line')
  })

  it('falls back to the first rich_text block when no question prompt is present', () => {
    const intro = richText('Some intro text for the section')
    expect(deriveSectionTitle([intro], 1)).toBe('Some intro text for the section')
  })

  it('falls back to generic Section N when no text content is found', () => {
    const q = questionSelect('')
    expect(deriveSectionTitle([q], 7)).toBe('Section 7')
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
  it('creates one section per question, anchor as last block', () => {
    const intro = richText('Read this intro first')
    const q1 = questionSelect('Pick true or false')
    const middle = richText('Some text between questions')
    const q2 = questionFreeResponse('What is 2+2?')

    const result = partitionBlocks([intro, q1, middle, q2])

    expect(result.isFlat).toBe(false)
    expect(result.sections).toHaveLength(2)
    // intro stays on exercise
    expect(result.exerciseSharedBlocks).toEqual([intro])
    // First section = q1 (no inter-section blocks yet)
    expect(result.sections[0].contentBlocks).toEqual([q1])
    // Second section = middle (inter-section) + q2 (question LAST)
    expect(result.sections[1].contentBlocks).toEqual([middle, q2])
  })

  it('attaches trailing non-question blocks to the LAST section (before the anchor question)', () => {
    const q1 = questionSelect('First question')
    const q2 = questionFreeResponse('Second question')
    const tail1 = richText('After q2 #1')
    const tail2 = richText('After q2 #2')

    const result = partitionBlocks([q1, q2, tail1, tail2])

    expect(result.sections).toHaveLength(2)
    expect(result.exerciseSharedBlocks).toEqual([])
    expect(result.sections[0].contentBlocks).toEqual([q1])
    // q2 has trailing non-question blocks. They attach to the LAST section
    // BEFORE the anchor question, so q2 remains the LAST block.
    expect(result.sections[1].contentBlocks).toEqual([tail1, tail2, q2])
    const last = result.sections[1].contentBlocks[result.sections[1].contentBlocks.length - 1]
    expect(last).toBe(q2)
  })

  it('attaches trailing non-question blocks to the LAST section, keeping the anchor as last block', () => {
    const intro = richText('Shared intro')
    const q = questionSelect('Only question')
    const tail = richText('Trailing shared text')

    const result = partitionBlocks([intro, q, tail])

    expect(result.exerciseSharedBlocks).toEqual([intro])
    expect(result.sections).toHaveLength(1)
    // Trailing blocks attach BEFORE the anchor question.
    expect(result.sections[0].contentBlocks).toEqual([tail, q])
    // Verify the anchor question is the LAST element (acceptance criterion).
    const last = result.sections[0].contentBlocks[result.sections[0].contentBlocks.length - 1]
    expect(last).toBe(q)
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

  it('derives a Section N fallback title when the anchor prompt is empty and there is no intro', () => {
    const q = questionSelect('')
    const result = partitionBlocks([q])
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].title).toBe('Section 1')
  })

  it('uses the question prompt as the section title', () => {
    const q = questionSelect('Solve x^2 = 4')
    const result = partitionBlocks([q])
    expect(result.sections[0].title).toBe('Solve x^2 = 4')
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
