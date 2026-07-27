/**
 * Regression tests for the sections wiring on both the export and import
 * sides of content-promotion.
 *
 * - `collectSectionRefsFromExerciseBlocks` mirrors the earlier lesson-side
 *   playlist walker (see content-promotion-collect-exercise-refs.test.ts)
 *   applied to exercise.blocks → sectionRef entries.
 * - `rewriteIdsInJsonBlocks` is the new import-time helper that rewrites
 *   remapped ids inside a JSON-encoded blocks string. Without it, remapped
 *   exercise ids stay stale inside lesson.blocks (and remapped section ids
 *   stay stale inside exercise.blocks), so the target's playlist would
 *   reference nothing.
 */
import { describe, expect, it } from 'vitest'

import { collectSectionRefsFromExerciseBlocks } from '@/server/services/content-promotion/export-content'
import { IdRemap } from '@/server/services/content-promotion/id-remap'
import { rewriteIdsInJsonBlocks } from '@/server/services/content-promotion/import-content'

const exercise = (blocks: unknown) => ({ id: 'E', blocks }) as Record<string, unknown>

describe('collectSectionRefsFromExerciseBlocks', () => {
  it('extracts every sectionRef.section id from a JSON-string blocks playlist', () => {
    const e = exercise(
      JSON.stringify([
        { blockType: 'sectionRef', section: 'sec-1', id: 'a' },
        { blockType: 'sectionRef', section: 'sec-2', id: 'b' },
      ]),
    )
    expect([...collectSectionRefsFromExerciseBlocks([e])].sort()).toEqual(['sec-1', 'sec-2'])
  })

  it('unions across multiple exercises and dedupes', () => {
    // Sections don't legitimately appear in two exercises' playlists in the
    // current model, but the walker should still dedupe defensively.
    const e1 = exercise(JSON.stringify([{ blockType: 'sectionRef', section: 'shared', id: 'a' }]))
    const e2 = exercise(
      JSON.stringify([
        { blockType: 'sectionRef', section: 'shared', id: 'a' },
        { blockType: 'sectionRef', section: 'unique', id: 'b' },
      ]),
    )
    expect([...collectSectionRefsFromExerciseBlocks([e1, e2])].sort()).toEqual(['shared', 'unique'])
  })

  it('ignores non-sectionRef blocks — an exercise playlist should only carry sectionRefs but be defensive', () => {
    const e = exercise(
      JSON.stringify([
        { blockType: 'sectionRef', section: 'sec-1', id: 'a' },
        { blockType: 'exerciseRef', exercise: 'ex-x', id: 'b' }, // wrong shape — ignore
      ]),
    )
    expect([...collectSectionRefsFromExerciseBlocks([e])]).toEqual(['sec-1'])
  })

  it('gracefully handles blocks that are missing / empty / non-string / malformed JSON / non-array', () => {
    expect(collectSectionRefsFromExerciseBlocks([exercise(undefined)]).size).toBe(0)
    expect(collectSectionRefsFromExerciseBlocks([exercise('')]).size).toBe(0)
    expect(collectSectionRefsFromExerciseBlocks([exercise([])]).size).toBe(0)
    expect(collectSectionRefsFromExerciseBlocks([exercise('{ not: valid json')]).size).toBe(0)
    expect(
      collectSectionRefsFromExerciseBlocks([exercise(JSON.stringify({ notArray: true }))]).size,
    ).toBe(0)
  })

  it('skips sectionRef entries whose section field is missing or empty', () => {
    const e = exercise(
      JSON.stringify([
        { blockType: 'sectionRef', section: '', id: 'empty' },
        { blockType: 'sectionRef', id: 'no-section-field' },
        { blockType: 'sectionRef', section: 'sec-real', id: 'ok' },
      ]),
    )
    expect([...collectSectionRefsFromExerciseBlocks([e])]).toEqual(['sec-real'])
  })
})

describe('rewriteIdsInJsonBlocks', () => {
  it('rewrites remapped ids inside a well-formed blocks JSON string', () => {
    // lesson.blocks scenario: exercise ids in the playlist got remapped at
    // import time. Without this rewrite, the playlist would still reference
    // the source ids and web renders would silently drop the entries.
    const remap = new IdRemap()
    remap.set('exercises', 'ex-old', 'ex-new')
    const raw = JSON.stringify([
      { blockType: 'exerciseRef', exercise: 'ex-old', id: 'a' },
      { blockType: 'exerciseRef', exercise: 'ex-keep', id: 'b' },
    ])
    const out = rewriteIdsInJsonBlocks(raw, remap) as string
    const parsed = JSON.parse(out) as Array<{ exercise: string }>
    expect(parsed[0].exercise).toBe('ex-new')
    expect(parsed[1].exercise).toBe('ex-keep')
  })

  it('rewrites section ids inside exercise.blocks (the sections-wiring case)', () => {
    const remap = new IdRemap()
    remap.set('sections', 'sec-old', 'sec-new')
    const raw = JSON.stringify([{ blockType: 'sectionRef', section: 'sec-old', id: 'a' }])
    const out = rewriteIdsInJsonBlocks(raw, remap) as string
    const parsed = JSON.parse(out) as Array<{ section: string }>
    expect(parsed[0].section).toBe('sec-new')
  })

  it('returns the input unchanged when nothing in the playlist matches the remap', () => {
    const remap = new IdRemap()
    remap.set('exercises', 'unrelated-src', 'unrelated-dst')
    const raw = JSON.stringify([{ blockType: 'exerciseRef', exercise: 'ex-1', id: 'a' }])
    const out = rewriteIdsInJsonBlocks(raw, remap) as string
    // Structurally equal even if JSON.stringify formatting differs.
    expect(JSON.parse(out)).toEqual(JSON.parse(raw))
  })

  it('passes through non-string, empty-string, and malformed JSON without throwing', () => {
    const remap = new IdRemap()
    expect(rewriteIdsInJsonBlocks(undefined, remap)).toBeUndefined()
    expect(rewriteIdsInJsonBlocks('', remap)).toBe('')
    expect(rewriteIdsInJsonBlocks('{ not valid json', remap)).toBe('{ not valid json')
    expect(rewriteIdsInJsonBlocks(42, remap)).toBe(42)
    expect(rewriteIdsInJsonBlocks(null, remap)).toBeNull()
  })

  it('preserves nested block ids that are not in the remap', () => {
    // The playlist's per-entry `id` fields (random short strings) must not
    // be treated as ids just because they live in the tree — they aren't
    // in the remap so deepRewriteIds returns them unchanged.
    const remap = new IdRemap()
    remap.set('exercises', 'ex-a', 'ex-b')
    const raw = JSON.stringify([
      { blockType: 'exerciseRef', exercise: 'ex-a', id: 'zX1_playlistBlockId' },
    ])
    const out = rewriteIdsInJsonBlocks(raw, remap) as string
    const parsed = JSON.parse(out) as Array<{ exercise: string; id: string }>
    expect(parsed[0].exercise).toBe('ex-b')
    expect(parsed[0].id).toBe('zX1_playlistBlockId')
  })
})
