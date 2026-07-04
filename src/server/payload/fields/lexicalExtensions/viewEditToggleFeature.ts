/**
 * @fileType server-feature
 * @domain payload
 * @pattern lexical-feature
 * @ai-summary Server feature declaration for the View/Edit mode toggle.
 *
 * The actual toolbar button lives on the client; this file provides the
 * server-side half so `defaultLexical` can reference a single feature
 * provider in `features: [...]`. The client component lives under
 * `@/ui/admin/lexicalExtensions/ViewEditToggleFeature/client`.
 */
import { createServerFeature } from '@payloadcms/richtext-lexical'

export const VIEW_EDIT_TOGGLE_FEATURE_KEY = 'viewEditToggle'

export const ViewEditToggleFeature = createServerFeature({
  feature: () => ({
    ClientFeature:
      '@/ui/admin/lexicalExtensions/ViewEditToggleFeature/client#ViewEditToggleFeatureClient',
  }),
  key: VIEW_EDIT_TOGGLE_FEATURE_KEY,
})
