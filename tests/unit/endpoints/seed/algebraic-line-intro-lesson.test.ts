/**
 * @fileType unit-test
 * @domain lessons
 * @pattern seed-validation
 * @ai-summary Unit tests for the algebraic-line-intro seed data factory.
 * Verifies: (1) the lesson + 12 exercises + 9 content pages exist with
 * the expected shapes, (2) no exercise prompt or option contains the
 * forbidden Hebrew words "משוואה" (equation) or "שיפוע" (slope),
 * (3) every MCQ's `correctOptionIds` references an existing option id,
 * and (4) the lesson `blocks` template references every content page
 * and every exercise key.
 */
import { describe, expect, it } from 'vitest'

import {
  ALGEBRAIC_LINE_INTRO_LESSON,
  FORBIDDEN_WORDS,
  getAlgebraicLineIntroBlocksTemplate,
  getAlgebraicLineIntroContentPages,
  getAlgebraicLineIntroExercises,
} from '@/server/payload/endpoints/seed/algebraic-line-intro-lesson'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

type McqBlock = Extract<ContentBlock, { variant: 'mcq' }>
type FreeResponseBlock = Extract<ContentBlock, { type: 'question_free_response' }>

function flattenStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const item of node) flattenStrings(item, out)
    return out
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) flattenStrings(value, out)
  }
  return out
}

describe('algebraic-line-intro seed data', () => {
  it('exposes stable identifiers', () => {
    expect(ALGEBRAIC_LINE_INTRO_LESSON.slug).toBe('algebraic-representation-line-intro')
    expect(ALGEBRAIC_LINE_INTRO_LESSON.title).toBe('ייצוג אלגברי של קו ישר — מבוא')
    expect(ALGEBRAIC_LINE_INTRO_LESSON.chapterId).toBe('18509e3e2746091012a71cbe')
    expect(ALGEBRAIC_LINE_INTRO_LESSON.courseId).toBe('8b35e70f2f9aa28cefc52f5f')
    expect(ALGEBRAIC_LINE_INTRO_LESSON.order).toBe(3)
  })

  it('produces 9 content pages with heading/paragraph/svg roles', () => {
    const pages = getAlgebraicLineIntroContentPages()
    expect(pages).toHaveLength(9)

    const headings = pages.filter((p) => p.key.startsWith('heading-'))
    const paragraphs = pages.filter((p) => p.key.startsWith('paragraph-'))
    const svgs = pages.filter((p) => p.key.startsWith('svg-'))

    expect(headings).toHaveLength(4)
    expect(paragraphs).toHaveLength(4)
    expect(svgs).toHaveLength(1)

    for (const page of pages) {
      expect(page.body).toHaveLength(1)
      expect(page.body[0]?.blockType).toBe('html')
      expect(typeof page.body[0]?.html).toBe('string')
    }
  })

  it('produces 12 exercises (10 mcq + 2 free-response) in pedagogical order', () => {
    const exercises = getAlgebraicLineIntroExercises()
    expect(exercises).toHaveLength(12)

    const mcq = exercises.filter((e) =>
      e.contentBlocks.some((b) => (b as { variant?: string }).variant === 'mcq'),
    )
    const free = exercises.filter((e) =>
      e.contentBlocks.some((b) => b.type === 'question_free_response'),
    )

    expect(mcq).toHaveLength(10)
    expect(free).toHaveLength(2)

    expect(exercises[4]?.key).toBe('ex-5') // first free-response
    expect(exercises[11]?.key).toBe('ex-12') // second free-response
  })

  it('every MCQ references an existing option id and matches the issue spec', () => {
    const exercises = getAlgebraicLineIntroExercises()
    const expectedCorrect: Record<string, string> = {
      'ex-1': 'o1',
      'ex-2': 'o2',
      'ex-3': 'o1',
      'ex-4': 'o2',
      'ex-6': 'o3',
      'ex-7': 'o2',
      'ex-8': 'o1',
      'ex-9': 'o2',
      'ex-10': 'o3',
      'ex-11': 'o2',
    }

    for (const exercise of exercises) {
      const block = exercise.contentBlocks.find(
        (b): b is McqBlock => (b as { variant?: string }).variant === 'mcq',
      )
      if (!block) continue
      const optionIds = new Set(block.answer.options.map((o) => o.id))
      for (const id of block.answer.correctOptionIds) {
        expect(optionIds.has(id), `exercise ${exercise.key} correctOptionId ${id} missing`).toBe(
          true,
        )
      }
      expect(
        block.answer.correctOptionIds,
        `exercise ${exercise.key} must have exactly 1 correct option for single-select MCQ`,
      ).toHaveLength(1)
      const expected = expectedCorrect[exercise.key]
      expect(expected, `unexpected MCQ key ${exercise.key}`).toBeDefined()
      expect(block.answer.correctOptionIds[0]).toBe(expected)
      expect(block.selectionMode).toBe('single')
      expect(block.answer.options.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('every free-response exercise has at least one accepted answer', () => {
    const exercises = getAlgebraicLineIntroExercises()
    for (const exercise of exercises) {
      const block = exercise.contentBlocks.find(
        (b): b is FreeResponseBlock => b.type === 'question_free_response',
      )
      if (!block) continue
      expect(block.answer.acceptedAnswers.length).toBeGreaterThan(0)
    }
  })

  it('does not use forbidden words in any content page or exercise', () => {
    const pages = getAlgebraicLineIntroContentPages()
    const exercises = getAlgebraicLineIntroExercises()

    for (const page of pages) {
      const html = page.body.map((b) => b.html).join('\n')
      const allStrings = flattenStrings({ html })
      for (const word of FORBIDDEN_WORDS) {
        expect(
          allStrings.some((s) => s.includes(word)),
          `content page "${page.key}" contains forbidden word "${word}"`,
        ).toBe(false)
      }
    }

    for (const exercise of exercises) {
      const allStrings = flattenStrings({ contentBlocks: exercise.contentBlocks })
      for (const word of FORBIDDEN_WORDS) {
        expect(
          allStrings.some((s) => s.includes(word)),
          `exercise "${exercise.key}" contains forbidden word "${word}"`,
        ).toBe(false)
      }
    }
  })

  it('builds a lesson blocks template referencing every content page and every exercise', () => {
    const pages = getAlgebraicLineIntroContentPages()
    const exercises = getAlgebraicLineIntroExercises()
    const template = getAlgebraicLineIntroBlocksTemplate()
    const blocks: Array<{
      id: string
      blockType: string
      exercise?: string
      contentPage?: string
    }> = JSON.parse(template)

    expect(blocks.length).toBe(pages.length + exercises.length)

    const referencedContentPages = new Set(
      blocks
        .filter((b) => b.blockType === 'contentPageRef' && b.contentPage)
        .map((b) => (b.contentPage as string).replace('__CONTENT_PAGE_', '').replace('__', '')),
    )
    const referencedExercises = new Set(
      blocks
        .filter((b) => b.blockType === 'exerciseRef' && b.exercise)
        .map((b) => (b.exercise as string).replace('__EXERCISE_', '').replace('__', '')),
    )

    for (const page of pages) {
      expect(referencedContentPages.has(page.key)).toBe(true)
    }
    for (const exercise of exercises) {
      expect(referencedExercises.has(exercise.key)).toBe(true)
    }

    // Order check: heading-1 must be the first block (lesson opening).
    const firstBlock = blocks[0]
    expect(firstBlock?.blockType).toBe('contentPageRef')
    expect(firstBlock?.contentPage).toBe('__CONTENT_PAGE_heading-1__')
  })
})
