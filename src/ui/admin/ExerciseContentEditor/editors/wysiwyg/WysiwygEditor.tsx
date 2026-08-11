'use client'

import React from 'react'
import type { AllToken } from './wysiwyg-tokens'
import { parseMdToHtml } from './wysiwyg-parse'
import { serializeDomToMd } from './wysiwyg-serialize'
import {
  applyInlineMark,
  applyToken,
  insertHeading,
  clearFormatting,
  insertAround,
} from './wysiwyg-format'

export interface WysiwygEditorHandle {
  applyMark: (tag: 'strong' | 'em') => void
  applyToken: (token: AllToken) => void
  insertHeading: () => void
  clearFormatting: () => void
  insertAround: (before: string, after: string) => void
  focus: () => void
}

interface WysiwygEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
}

/**
 * Contenteditable surface that renders md-math-v1 as live-formatted HTML.
 * Users see bold/italic/color/size applied inline as they type; toolbar
 * operations mutate the DOM directly through the imperative handle and the
 * component re-serializes on `input` back to md-math-v1 storage format.
 *
 * We only re-hydrate innerHTML when the *external* value changes to a value
 * that doesn't match what we just serialized — otherwise every keystroke would
 * reset the caret to the top of the div.
 */
export const WysiwygEditor = React.forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  ({ value, onChange, placeholder, minHeight = '80px' }, ref) => {
    const rootRef = React.useRef<HTMLDivElement>(null)
    const lastEmittedRef = React.useRef<string>(value)

    const hydrate = React.useCallback((source: string) => {
      const root = rootRef.current
      if (!root) return
      root.innerHTML = parseMdToHtml(source)
      lastEmittedRef.current = source
      root.setAttribute('data-empty', source.trim() === '' ? 'true' : 'false')
    }, [])

    React.useEffect(() => {
      if (value === lastEmittedRef.current) return
      hydrate(value)
    }, [value, hydrate])

    React.useEffect(() => {
      hydrate(value)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const emitChange = React.useCallback(() => {
      const root = rootRef.current
      if (!root) return
      const md = serializeDomToMd(root)
      lastEmittedRef.current = md
      root.setAttribute('data-empty', md.trim() === '' ? 'true' : 'false')
      onChange(md)
    }, [onChange])

    React.useImperativeHandle(
      ref,
      () => ({
        applyMark: (tag) => {
          if (!rootRef.current) return
          applyInlineMark(rootRef.current, tag)
          emitChange()
        },
        applyToken: (token) => {
          if (!rootRef.current) return
          applyToken(rootRef.current, token)
          emitChange()
        },
        insertHeading: () => {
          if (!rootRef.current) return
          insertHeading(rootRef.current)
          emitChange()
        },
        clearFormatting: () => {
          if (!rootRef.current) return
          clearFormatting(rootRef.current)
          emitChange()
        },
        insertAround: (before, after) => {
          if (!rootRef.current) return
          insertAround(rootRef.current, before, after)
          emitChange()
        },
        focus: () => rootRef.current?.focus(),
      }),
      [emitChange],
    )

    return (
      <div
        ref={rootRef}
        className="inline-rich-text-wysiwyg rich-text-content"
        style={{ minHeight }}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-testid="rte-wysiwyg"
        dir="auto"
        onInput={emitChange}
      />
    )
  },
)

WysiwygEditor.displayName = 'WysiwygEditor'
