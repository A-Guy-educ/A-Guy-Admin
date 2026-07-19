/**
 * Regression tests for `collectExerciseRefsFromLessonBlocks` — the pure
 * playlist walker added to the exporter after the `word-problems-5` bundle
 * incident where 3 exercises referenced by lesson.blocks were dropped
 * because `where: { lesson: { in: [...] } }` didn't match them.
 */
import { describe, expect, it } from 'vitest'

import { collectExerciseRefsFromLessonBlocks } from '@/server/services/content-promotion/export-content'

const lesson = (blocks: unknown) => ({ id: 'L', blocks }) as Record<string, unknown>

describe('collectExerciseRefsFromLessonBlocks', () => {
  it('extracts every exerciseRef.exercise id from a JSON-string blocks playlist', () => {
    const l = lesson(
      JSON.stringify([
        { blockType: 'exerciseRef', exercise: 'ex-1', id: 'a' },
        { blockType: 'exerciseRef', exercise: 'ex-2', id: 'b' },
      ]),
    )
    expect([...collectExerciseRefsFromLessonBlocks([l])].sort()).toEqual(['ex-1', 'ex-2'])
  })

  it('unions across multiple lessons — deduped', () => {
    const l1 = lesson(JSON.stringify([{ blockType: 'exerciseRef', exercise: 'shared', id: 'a' }]))
    const l2 = lesson(
      JSON.stringify([
        { blockType: 'exerciseRef', exercise: 'shared', id: 'a' },
        { blockType: 'exerciseRef', exercise: 'unique', id: 'b' },
      ]),
    )
    expect([...collectExerciseRefsFromLessonBlocks([l1, l2])].sort()).toEqual(['shared', 'unique'])
  })

  it('ignores non-exerciseRef blocks (e.g. contentPageRef) if any exist', () => {
    const l = lesson(
      JSON.stringify([
        { blockType: 'exerciseRef', exercise: 'ex-1', id: 'a' },
        { blockType: 'contentPageRef', contentPage: 'cp-1', id: 'b' },
      ]),
    )
    expect([...collectExerciseRefsFromLessonBlocks([l])]).toEqual(['ex-1'])
  })

  it('gracefully handles lessons whose blocks field is missing, empty, or not a string', () => {
    // Missing / empty / wrong type — the field is a textarea but legacy or
    // freshly-created lessons may not carry it yet. Never abort the whole
    // export just because one lesson has a weird shape.
    expect(collectExerciseRefsFromLessonBlocks([lesson(undefined)]).size).toBe(0)
    expect(collectExerciseRefsFromLessonBlocks([lesson('')]).size).toBe(0)
    expect(collectExerciseRefsFromLessonBlocks([lesson([])]).size).toBe(0)
    expect(collectExerciseRefsFromLessonBlocks([lesson({ blocks: [] })]).size).toBe(0)
  })

  it('gracefully handles malformed JSON in blocks', () => {
    // A hand-edited or half-written blocks field should not blow up the
    // whole export — silently skip that lesson.
    const l = lesson('{ not: valid json')
    expect(collectExerciseRefsFromLessonBlocks([l]).size).toBe(0)
  })

  it('ignores blocks whose parsed value is not an array', () => {
    // JSON.parse of an object literal returns an object — still valid JSON
    // but not the playlist shape we expect. Don't misread properties as
    // block entries.
    const l = lesson(JSON.stringify({ notAnArray: true }))
    expect(collectExerciseRefsFromLessonBlocks([l]).size).toBe(0)
  })

  it('skips exerciseRef entries whose exercise field is missing or empty', () => {
    const l = lesson(
      JSON.stringify([
        { blockType: 'exerciseRef', exercise: '', id: 'empty' },
        { blockType: 'exerciseRef', id: 'no-exercise-field' },
        { blockType: 'exerciseRef', exercise: 'ex-real', id: 'ok' },
      ]),
    )
    expect([...collectExerciseRefsFromLessonBlocks([l])]).toEqual(['ex-real'])
  })
})
