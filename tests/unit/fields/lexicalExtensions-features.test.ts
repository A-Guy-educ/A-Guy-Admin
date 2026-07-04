/**
 * @fileType unit-test
 * @domain fields
 * @pattern lexical-feature
 * @ai-summary Verifies that the server-feature wrappers exposed by the
 *   lexicalExtensions barrel produce the expected feature-provider shape
 *   (key, ClientFeature reference, client props) needed by
 *   Payload's lexicalEditor to mount them on the client.
 */
import { describe, expect, it } from 'vitest'

import {
  EditorTextStateFeature,
  VIEW_EDIT_TOGGLE_FEATURE_KEY,
  ViewEditToggleFeature,
} from '@/server/payload/fields/lexicalExtensions'

type ServerFeature = {
  ClientFeature?: string
  clientFeatureProps?: unknown
}

type FeatureProvider = {
  key: string
  feature:
    | ((props?: Record<string, unknown>) => Promise<ServerFeature> | ServerFeature)
    | ServerFeature
}

// `FeatureProviderServer.feature` is a union of a callable and an object;
// cast to the runnable shape for tests that need to resolve the feature.
const resolveFeature = async (provider: FeatureProvider): Promise<ServerFeature> => {
  const feature = provider.feature
  if (typeof feature === 'function') {
    return await feature({})
  }
  return feature
}

describe('EditorTextStateFeature', () => {
  it('returns a feature provider with the textState key', () => {
    const provider = EditorTextStateFeature() as unknown as FeatureProvider
    expect(provider.key).toBe('textState')
  })

  it('exposes the TextStateFeatureClient client reference', async () => {
    const provider = EditorTextStateFeature() as unknown as FeatureProvider
    const resolved = await resolveFeature(provider)
    expect(resolved.ClientFeature).toBe(
      '@payloadcms/richtext-lexical/client#TextStateFeatureClient',
    )
  })

  it('forwards the issue #109 state config to the client', async () => {
    const provider = EditorTextStateFeature() as unknown as FeatureProvider
    const resolved = await resolveFeature(provider)
    const clientProps = resolved.clientFeatureProps as { state?: unknown }
    expect(clientProps.state).toBeDefined()
    const state = clientProps.state as Record<string, Record<string, unknown>>
    expect(Object.keys(state).sort()).toEqual(['editorColor', 'editorSize'])
    expect(Object.keys(state.editorColor).sort()).toEqual(['blue', 'green', 'orange', 'wine'])
    expect(Object.keys(state.editorSize).sort()).toEqual(['large', 'normal', 'small', 'xlarge'])
  })
})

describe('ViewEditToggleFeature', () => {
  it('returns a feature provider with the expected key', () => {
    const provider = ViewEditToggleFeature() as unknown as FeatureProvider
    expect(provider.key).toBe(VIEW_EDIT_TOGGLE_FEATURE_KEY)
  })

  it('references the custom client feature path registered in importMap', async () => {
    const provider = ViewEditToggleFeature() as unknown as FeatureProvider
    const resolved = await resolveFeature(provider)
    expect(resolved.ClientFeature).toBe(
      '@/ui/admin/lexicalExtensions/ViewEditToggleFeature/client#ViewEditToggleFeatureClient',
    )
  })

  it('exposes a string key constant for callers (e.g. resolved feature map lookup)', () => {
    expect(VIEW_EDIT_TOGGLE_FEATURE_KEY).toBe('viewEditToggle')
    const provider = ViewEditToggleFeature() as unknown as FeatureProvider
    // `feature.key` is the dispatch key used by Payload's resolvedFeatureMap —
    // sanity-check it matches the exported constant.
    expect(provider.key).toBe(VIEW_EDIT_TOGGLE_FEATURE_KEY)
  })
})
