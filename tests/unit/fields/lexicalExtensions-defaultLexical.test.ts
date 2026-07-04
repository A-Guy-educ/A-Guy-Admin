/**
 * @fileType unit-test
 * @domain fields
 * @pattern lexical-feature
 * @ai-summary Validates that the Lexical editor used across the project
 *   (`defaultLexical`) exposes the toolbar controls required by issue
 *   #109 in addition to the original five (bold, italic, underline,
 *   link, paragraph).
 *
 * Reads from the static `defaultLexicalFeatures` array so we don't have
 * to spin up a full Payload config to resolve `lexicalEditor()`.
 */
import { describe, expect, it } from 'vitest'

import { defaultLexicalFeatures } from '@/server/payload/fields/defaultLexical'

// Payload feature factories return a "feature provider" object whose
// `key` is the dispatch identifier used by `lexicalEditor`. We never
// exercise the `feature()` async callback here — that one needs a real
// Payload config.
const getKey = (provider: unknown): string => {
  return String((provider as { key?: string }).key ?? '')
}

describe('defaultLexical editor features', () => {
  const keys = defaultLexicalFeatures.map(getKey)

  it('keeps the original toolbar controls (bold, italic, underline, link, paragraph)', () => {
    for (const required of ['bold', 'italic', 'underline', 'link', 'paragraph']) {
      expect(keys).toContain(required)
    }
  })

  it('adds right-align support via AlignFeature', () => {
    expect(keys).toContain('align')
  })

  it('adds color and size support via TextStateFeature', () => {
    expect(keys).toContain('textState')
  })

  it('adds the View/Edit toggle feature introduced in issue #109', () => {
    expect(keys).toContain('viewEditToggle')
  })

  it('adds the fixed toolbar so all controls are visible above the content', () => {
    expect(keys).toContain('toolbarFixed')
  })
})
