/**
 * @fileType utility
 * @domain payload
 * @pattern lexical-feature-state
 * @ai-summary Composed TextState configuration for the Lexical editor.
 *
 * Combines the issue #109 color swatches and font sizes into a single state
 * object accepted by Payload's experimental `TextStateFeature`. The two keys
 * ('color' and 'size') are kept separate so a user can apply a colour and a
 * size independently to the same range.
 */
import { editorHighlightColorConfig, type EditorColorId } from './colors'
import { editorTextSizeConfig, type EditorTextSizeId } from './textSizes'
import type { EditorStateConfig } from './_types'

export const EDITOR_STATE_COLOR_KEY = 'editorColor' as const
export const EDITOR_STATE_SIZE_KEY = 'editorSize' as const

export type EditorTextStateColor = EditorColorId
export type EditorTextStateSize = EditorTextSizeId

export const editorTextStateConfig: EditorStateConfig = {
  [EDITOR_STATE_COLOR_KEY]: editorHighlightColorConfig,
  [EDITOR_STATE_SIZE_KEY]: editorTextSizeConfig,
}
