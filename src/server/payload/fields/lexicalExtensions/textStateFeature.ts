/**
 * @fileType server-feature
 * @domain payload
 * @pattern lexical-feature
 * @ai-summary Server feature wiring Payload's experimental TextStateFeature
 *   with the highlight colours and font sizes defined in `textStateConfig`.
 */
import { TextStateFeature } from '@payloadcms/richtext-lexical'

import { editorTextStateConfig } from './textStateConfig'

export const TEXT_STATE_FEATURE_KEY = 'editorTextState'

/**
 * Returns a configured `TextStateFeature` whose toolbar offers the
 * 4 highlight colour swatches and 4 text sizes required by issue #109.
 *
 * Wrap the result in an array before adding it to the `features` array
 * of `lexicalEditor(...)` since the feature factory returns a feature
 * provider (a callable), not a feature object.
 */
export const EditorTextStateFeature = () =>
  TextStateFeature({
    state: editorTextStateConfig,
  })
