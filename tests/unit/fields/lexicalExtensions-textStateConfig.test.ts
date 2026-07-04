/**
 * @fileType unit-test
 * @domain fields
 * @pattern lexical-feature-state
 * @ai-summary Tests that the combined TextState configuration supplies both
 *   color and size state keys, each populated by the swatches/sizes from
 *   issue #109.
 */
import { describe, expect, it } from 'vitest'

import {
  EDITOR_STATE_COLOR_KEY,
  EDITOR_STATE_SIZE_KEY,
  editorTextStateConfig,
} from '@/server/payload/fields/lexicalExtensions/textStateConfig'

describe('editorTextStateConfig', () => {
  it('defines exactly two state keys: color and size', () => {
    expect(Object.keys(editorTextStateConfig).sort()).toEqual(
      [EDITOR_STATE_COLOR_KEY, EDITOR_STATE_SIZE_KEY].sort(),
    )
  })

  it('exports the documented constants', () => {
    expect(EDITOR_STATE_COLOR_KEY).toBe('editorColor')
    expect(EDITOR_STATE_SIZE_KEY).toBe('editorSize')
  })

  it('color state contains the four swatches required by the issue', () => {
    const colors = editorTextStateConfig[EDITOR_STATE_COLOR_KEY]
    expect(Object.keys(colors).sort()).toEqual(['blue', 'green', 'orange', 'wine'])
  })

  it('size state contains the four sizes required by the issue', () => {
    const sizes = editorTextStateConfig[EDITOR_STATE_SIZE_KEY]
    expect(Object.keys(sizes).sort()).toEqual(['large', 'normal', 'small', 'xlarge'])
  })

  it('color and size keys do not overlap (each value key must be unique)', () => {
    const colorValues = Object.keys(editorTextStateConfig[EDITOR_STATE_COLOR_KEY])
    const sizeValues = Object.keys(editorTextStateConfig[EDITOR_STATE_SIZE_KEY])
    for (const v of colorValues) {
      expect(sizeValues).not.toContain(v)
    }
  })
})
