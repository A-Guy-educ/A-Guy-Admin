import { describe, expect, it } from 'vitest'

import {
  deepRewriteIds,
  generateNewId,
  IdRemap,
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
