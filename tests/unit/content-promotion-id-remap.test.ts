import { describe, expect, it } from 'vitest'

import {
  deepRewriteIds,
  generateNewId,
  IdRemap,
  nextAvailableSuffix,
  SlugRemap,
} from '@/server/services/content-promotion/id-remap'

describe('generateNewId', () => {
  it('produces a 24-character lowercase hex string', () => {
    const id = generateNewId()
    expect(id).toMatch(/^[a-f0-9]{24}$/)
  })

  it('produces unique values across calls', () => {
    const a = generateNewId()
    const b = generateNewId()
    expect(a).not.toBe(b)
  })
})

describe('IdRemap', () => {
  it('looks up entries by collection + old id', () => {
    const remap = new IdRemap()
    remap.set('courses', 'oldA', 'newA')
    expect(remap.get('courses', 'oldA')).toBe('newA')
    expect(remap.get('lessons', 'oldA')).toBeUndefined()
  })

  it('rewriteAny finds new ids regardless of collection', () => {
    const remap = new IdRemap()
    remap.set('media', 'm1', 'm1new')
    expect(remap.rewriteAny('m1')).toBe('m1new')
    expect(remap.rewriteAny('not-in-table')).toBeUndefined()
  })

  it('size tracks number of remapped entries', () => {
    const remap = new IdRemap()
    expect(remap.size()).toBe(0)
    remap.set('courses', 'a', 'a2')
    remap.set('lessons', 'b', 'b2')
    expect(remap.size()).toBe(2)
  })

  it('throws when the same source id is remapped to two different new ids across collections', () => {
    const remap = new IdRemap()
    remap.set('courses', 'sharedId', 'newA')
    expect(() => remap.set('lessons', 'sharedId', 'newB')).toThrow(/IdRemap collision/)
  })

  it('is a no-op when the same (collection, oldId, newId) triple is set twice', () => {
    const remap = new IdRemap()
    remap.set('courses', 'sharedId', 'newA')
    expect(() => remap.set('courses', 'sharedId', 'newA')).not.toThrow()
    expect(remap.size()).toBe(1)
  })
})

describe('deepRewriteIds', () => {
  it('rewrites a single string id', () => {
    const remap = new IdRemap()
    remap.set('media', 'mediaA', 'mediaA2')
    expect(deepRewriteIds('mediaA', remap)).toBe('mediaA2')
  })

  it('leaves unrelated strings untouched', () => {
    const remap = new IdRemap()
    remap.set('media', 'mediaA', 'mediaA2')
    expect(deepRewriteIds('hello world', remap)).toBe('hello world')
  })

  it('rewrites ids nested inside arrays', () => {
    const remap = new IdRemap()
    remap.set('media', 'a', 'a2')
    remap.set('media', 'b', 'b2')
    expect(deepRewriteIds(['a', 'untouched', 'b'], remap)).toEqual(['a2', 'untouched', 'b2'])
  })

  it('rewrites ids deep inside an object tree (exercise content blocks)', () => {
    const remap = new IdRemap()
    remap.set('media', 'm1', 'm1new')
    remap.set('lessons', 'L1', 'L1new')

    const doc = {
      id: 'exercise-1',
      lesson: 'L1',
      content: {
        blocks: [
          {
            type: 'rich_text',
            value: 'Look at the image',
            mediaIds: ['m1', 'other'],
          },
        ],
      },
    }

    const out = deepRewriteIds(doc, remap)
    expect(out.lesson).toBe('L1new')
    expect((out.content.blocks[0] as { mediaIds: string[] }).mediaIds).toEqual(['m1new', 'other'])
    // Inputs must remain unchanged (no mutation).
    expect(doc.lesson).toBe('L1')
  })

  it('handles null and primitive values safely', () => {
    const remap = new IdRemap()
    expect(deepRewriteIds(null, remap)).toBeNull()
    expect(deepRewriteIds(42, remap)).toBe(42)
    expect(deepRewriteIds(true, remap)).toBe(true)
  })
})

describe('SlugRemap', () => {
  it('keys entries by (collection, sourceDocId) so two docs with the same source slug can get different targets', () => {
    // Regression for the collision on "אחוזים"/percentage-1: two lessons in
    // the bundle can legitimately share a source slug (different courses on
    // the source), and both need distinct target slugs — a slug→newSlug map
    // would clobber the first with the second.
    const remap = new SlugRemap()
    remap.set('lessons', 'sourceId-A', 'percentage-1-1')
    remap.set('lessons', 'sourceId-B', 'percentage-1-2')
    expect(remap.get('lessons', 'sourceId-A')).toBe('percentage-1-1')
    expect(remap.get('lessons', 'sourceId-B')).toBe('percentage-1-2')
    expect(remap.size()).toBe(2)
  })

  it('scopes lookups per collection', () => {
    const remap = new SlugRemap()
    remap.set('lessons', 'same-id', 'lesson-slug')
    remap.set('chapters', 'same-id', 'chapter-slug')
    expect(remap.get('lessons', 'same-id')).toBe('lesson-slug')
    expect(remap.get('chapters', 'same-id')).toBe('chapter-slug')
    expect(remap.get('lessons', 'unknown-id')).toBeUndefined()
  })
})

describe('nextAvailableSuffix', () => {
  it('returns the first "-n" candidate not already in the committed set', () => {
    const committed = new Set<string>(['foo', 'foo-1'])
    expect(nextAvailableSuffix('foo', committed)).toBe('foo-2')
    expect(committed.has('foo-2')).toBe(true)
  })

  it('skips gaps that later remaps have already reserved', () => {
    const committed = new Set<string>(['foo', 'foo-1', 'foo-2', 'foo-3'])
    expect(nextAvailableSuffix('foo', committed)).toBe('foo-4')
  })

  it('adds the returned candidate to the committed set so chained calls do not collide', () => {
    const committed = new Set<string>(['foo'])
    const first = nextAvailableSuffix('foo', committed)
    const second = nextAvailableSuffix('foo', committed)
    expect(first).toBe('foo-1')
    expect(second).toBe('foo-2')
  })

  it('starts at -1 when only the base is taken', () => {
    const committed = new Set<string>(['bar'])
    expect(nextAvailableSuffix('bar', committed)).toBe('bar-1')
  })

  it('throws if 1000 suffixes are all taken (runaway guard)', () => {
    const committed = new Set<string>(['x'])
    for (let n = 1; n <= 1_000; n += 1) committed.add(`x-${n}`)
    expect(() => nextAvailableSuffix('x', committed)).toThrow(/exhausted 1000 attempts/)
  })
})
