/**
 * @fileType utility
 * @domain payload
 * @pattern lexical-feature-state
 * @ai-summary Text size definitions for the Lexical editor TextState feature.
 *
 * Four sizes specified by issue #109: small, normal, large, x-large.
 * Each size stores a font-size value plus the data-size attribute Payload's
 * TextState plugin writes to the DOM, so the rendered output is recoverable
 * across save+reload even if the inline style is normalised away.
 */
import type { EditorStateMap, EditorStyleObject } from './_types'

export type EditorTextSizeId = 'small' | 'normal' | 'large' | 'xlarge'

export type EditorTextSizeValue = {
  css: EditorStyleObject
  label: string
}

export type EditorTextSizeMap = Record<EditorTextSizeId, EditorTextSizeValue>

export const editorTextSizes: EditorTextSizeMap = {
  small: {
    css: {
      'font-size': '0.875rem',
    },
    label: 'Small',
  },
  normal: {
    css: {
      'font-size': '1rem',
    },
    label: 'Normal',
  },
  large: {
    css: {
      'font-size': '1.25rem',
    },
    label: 'Large',
  },
  xlarge: {
    css: {
      'font-size': '1.5rem',
    },
    label: 'X-Large',
  },
}

export const editorTextSizeOrder: ReadonlyArray<EditorTextSizeId> = [
  'small',
  'normal',
  'large',
  'xlarge',
]

export const editorTextSizeConfig: EditorStateMap = editorTextSizes
