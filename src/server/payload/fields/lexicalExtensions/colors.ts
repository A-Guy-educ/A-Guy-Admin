/**
 * @fileType utility
 * @domain payload
 * @pattern lexical-feature-state
 * @ai-summary Highlight color definitions for the Lexical editor TextState feature.
 *
 * Four swatches specified by issue #109: wine red, blue, green, dark orange.
 * Each entry stores color values for both light and dark mode via the
 * `light-dark()` CSS function so the swatch is legible in either admin theme.
 */
import type { EditorStateMap, EditorStyleObject } from './_types'

export type EditorColorId = 'wine' | 'blue' | 'green' | 'orange'

export type EditorColorValue = {
  css: EditorStyleObject
  label: string
}

export type EditorColorMap = Record<EditorColorId, EditorColorValue>

/**
 * Highlight colors defined in issue #109. The base hex values map to
 * Tailwind-aligned design system anchors, but adjusted for both light and
 * dark modes so swatches stay legible in either theme.
 */
export const editorHighlightColors: EditorColorMap = {
  wine: {
    css: {
      color: 'light-dark(#7B1E3A, #F4A8C0)',
    },
    label: 'Wine',
  },
  blue: {
    css: {
      color: 'light-dark(#1E40AF, #93C5FD)',
    },
    label: 'Blue',
  },
  green: {
    css: {
      color: 'light-dark(#15803D, #86EFAC)',
    },
    label: 'Green',
  },
  orange: {
    css: {
      color: 'light-dark(#9A3412, #FDBA74)',
    },
    label: 'Dark orange',
  },
}

export const editorHighlightColorOrder: ReadonlyArray<EditorColorId> = [
  'wine',
  'blue',
  'green',
  'orange',
]

export const editorHighlightColorConfig: EditorStateMap = editorHighlightColors
