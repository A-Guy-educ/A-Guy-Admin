import { describe, it, expect } from 'vitest'
import { canonicalStringify, computeContentHash, hashTextSha256 } from '@/server/utils/hash'

describe('hashTextSha256', () => {
  it('produces consistent hex output', () => {
    const hash1 = hashTextSha256('test')
    const hash2 = hashTextSha256('test')
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces different hash for different input', () => {
    const hash1 = hashTextSha256('test1')
    const hash2 = hashTextSha256('test2')
    expect(hash1).not.toBe(hash2)
  })
})

describe('canonicalStringify', () => {
  it('handles null', () => {
    expect(canonicalStringify(null)).toBe('null')
  })

  it('handles booleans', () => {
    expect(canonicalStringify(true)).toBe('true')
    expect(canonicalStringify(false)).toBe('false')
  })

  it('handles strings with proper JSON escaping', () => {
    expect(canonicalStringify('hello')).toBe('"hello"')
  })

  it('handles arrays', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]')
  })

  it('is stable across multiple calls', () => {
    const obj = { z: 1, a: 2 }
    expect(canonicalStringify(obj)).toBe(canonicalStringify(obj))
  })
})

describe('computeContentHash', () => {
  it('produces same hash for identical exercises', () => {
    const exercise = {
      title: 'Test',
      blocks: [{ blockType: 'content', content: 'hello' }],
    }
    expect(computeContentHash(exercise)).toBe(computeContentHash(exercise))
  })

  it('produces different hash for different titles', () => {
    const ex1 = { title: 'A', blocks: [] }
    const ex2 = { title: 'B', blocks: [] }
    expect(computeContentHash(ex1)).not.toBe(computeContentHash(ex2))
  })

  it('produces different hash for different block order', () => {
    const ex1 = { title: 'T', blocks: [{ blockType: 'a' }, { blockType: 'b' }] }
    const ex2 = { title: 'T', blocks: [{ blockType: 'b' }, { blockType: 'a' }] }
    expect(computeContentHash(ex1)).not.toBe(computeContentHash(ex2))
  })

  it('normalizes whitespace', () => {
    const ex1 = { title: 'Test', blocks: [{ blockType: 'content', content: 'hello   world' }] }
    const ex2 = { title: 'Test', blocks: [{ blockType: 'content', content: 'hello world' }] }
    expect(computeContentHash(ex1)).toBe(computeContentHash(ex2))
  })
})
