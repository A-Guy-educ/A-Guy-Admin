/**
 * @fileType barrel
 * @domain payload
 * @pattern lexical-feature
 * @ai-summary Public surface of the Lexical toolbar extensions introduced
 *   by issue #109.
 */
export {
  editorHighlightColors,
  editorHighlightColorOrder,
  type EditorColorId,
  type EditorColorMap,
  type EditorColorValue,
} from './colors'
export {
  editorTextSizes,
  editorTextSizeOrder,
  type EditorTextSizeId,
  type EditorTextSizeMap,
  type EditorTextSizeValue,
} from './textSizes'
export {
  EDITOR_STATE_COLOR_KEY,
  EDITOR_STATE_SIZE_KEY,
  editorTextStateConfig,
} from './textStateConfig'
export { EditorTextStateFeature, TEXT_STATE_FEATURE_KEY } from './textStateFeature'
export { VIEW_EDIT_TOGGLE_FEATURE_KEY, ViewEditToggleFeature } from './viewEditToggleFeature'
