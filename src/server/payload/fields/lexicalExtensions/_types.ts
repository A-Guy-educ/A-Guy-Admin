/**
 * @fileType utility
 * @domain payload
 * @pattern lexical-feature-state
 * @ai-summary Local shape for Payload's TextState `css` style values.
 *
 * Payload's experimental `TextStateFeature` types each value's `css` field
 * as `StyleObject`, which is a flat `PropertiesHyphenFallback` map with
 * `string`-only values (no numeric shortcuts like React's `CSSProperties`).
 * Since `StyleObject` lives in a sub-path Payload doesn't expose publicly,
 * we redefine the structural shape here. Keeping the two types in sync by
 * intent rather than by import keeps us insulated from Payload's internal
 * module layout while still letting the `TextStateFeature` factory accept
 * our config without `as any`.
 */
export type EditorStyleObject = { [K in string]?: string | undefined }

export type EditorStateValue = {
  css: EditorStyleObject
  label: string
}

export type EditorStateMap = { [valueKey: string]: EditorStateValue }

export type EditorStateConfig = { [stateKey: string]: EditorStateMap }
