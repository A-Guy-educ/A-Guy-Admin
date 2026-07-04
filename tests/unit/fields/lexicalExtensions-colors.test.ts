/**
 * @fileType unit-test
 * @domain fields
 * @pattern lexical-feature-state
 * @ai-summary Tests that the issue #109 highlight-colour palette exposes the
 *   four required swatches with light/dark mode aware styles.
 */
import { describe, expect, it } from 'vitest'

import {
  editorHighlightColors,
  editorHighlightColorOrder,
} from '@/server/payload/fields/lexicalExtensions/colors'

describe('editorHighlightColors', () => {
  it('exposes exactly the four swatches required by issue #109', () => {
    const ids = Object.keys(editorHighlightColors).sort()
    expect(ids).toEqual(['blue', 'green', 'orange', 'wine'])
  })

  it('preserves the spec order: wine, blue, green, dark orange', () => {
    expect(editorHighlightColorOrder).toEqual(['wine', 'blue', 'green', 'orange'])
  })

  it('provides a non-empty label for every swatch', () => {
    for (const id of editorHighlightColorOrder) {
      expect(editorHighlightColors[id].label.length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['wine', '#7B1E3A'],
    ['blue', '#1E40AF'],
    ['green', '#15803D'],
    ['orange', '#9A3412'],
  ] as const)('%s swatch uses the issue-mandated base hex %s in light mode', (id, hex) => {
    const cssColor = editorHighlightColors[id].css.color
    expect(typeof cssColor).toBe('string')
    // The `light-dark()` CSS helper wraps both modes in a single value
    expect(cssColor).toContain(hex)
    expect(cssColor).toMatch(/^light-dark\(/)
  })

  it('each swatch provides a contrast color usable in dark mode', () => {
    for (const id of editorHighlightColorOrder) {
      const cssColor = editorHighlightColors[id].css.color
      // light-dark(a, b) → b is the dark-mode color
      expect(cssColor).toMatch(/^light-dark\([^,]+,\s*[^)]+\)$/)
    }
  })
})
