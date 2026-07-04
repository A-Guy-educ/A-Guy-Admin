/**
 * @fileType unit-test
 * @domain fields
 * @pattern lexical-feature-state
 * @ai-summary Tests that the Lexical text-size palette defines the four
 *   sizes required by issue #109 (small, normal, large, x-large).
 */
import { describe, expect, it } from 'vitest'

import {
  editorTextSizes,
  editorTextSizeOrder,
} from '@/server/payload/fields/lexicalExtensions/textSizes'

describe('editorTextSizes', () => {
  it('exposes exactly the four sizes required by issue #109', () => {
    const ids = Object.keys(editorTextSizes).sort()
    expect(ids).toEqual(['large', 'normal', 'small', 'xlarge'])
  })

  it('preserves the spec order: small, normal, large, x-large', () => {
    expect(editorTextSizeOrder).toEqual(['small', 'normal', 'large', 'xlarge'])
  })

  it('every size provides a non-empty label', () => {
    for (const id of editorTextSizeOrder) {
      expect(editorTextSizes[id].label.length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['small', '0.875rem'],
    ['normal', '1rem'],
    ['large', '1.25rem'],
    ['xlarge', '1.5rem'],
  ] as const)('%s size uses the issue-mandated rem value %s', (id, expectedFontSize) => {
    expect(editorTextSizes[id].css['font-size']).toBe(expectedFontSize)
  })

  it('size keys are unique across the map (so TextStateFeature dropdowns do not collide)', () => {
    const seen = new Set<string>()
    for (const id of editorTextSizeOrder) {
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  })
})
