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
  clearColor,
  insertAround,
} from './wysiwyg-format'
import { useEditorHandlers } from './use-editor-handlers'

export interface WysiwygEditorHandle {
  applyMark: (tag: 'strong' | 'em') => void
  applyToken: (token: AllToken) => void
  insertHeading: () => void
  clearFormatting: () => void
  clearColor: () => void
  insertAround: (before: string, after: string) => void
  focus: () => void
}

interface WysiwygEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
}

// Sentinel so the first render always hydrates (one effect covers mount + updates).
const UNHYDRATED: unique symbol = Symbol('unhydrated')

// Contenteditable that renders md-math-v1 as live-formatted HTML. Toolbar
// actions mutate the DOM through the handle; input events serialize back to
// md. Re-hydrate only when the external value diverges from what we last
// emitted, otherwise every keystroke would reset the caret to the top.
export const WysiwygEditor = React.forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(
  ({ value, onChange, placeholder, minHeight = '80px' }, ref) => {
    const rootRef = React.useRef<HTMLDivElement>(null)
    const lastEmittedRef = React.useRef<string | typeof UNHYDRATED>(UNHYDRATED)
    const composingRef = React.useRef(false)

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

    const emitChange = React.useCallback(() => {
      const root = rootRef.current
      if (!root) return
      const md = serializeDomToMd(root)
      lastEmittedRef.current = md
      root.setAttribute('data-empty', md.trim() === '' ? 'true' : 'false')
      onChange(md)
    }, [onChange])

    // Skip the onChange if the action was a no-op — Bold with a bare caret
    // shouldn't dirty the form or wake autosave.
    const runAction = React.useCallback(
      (action: (root: HTMLElement) => boolean) => {
        const root = rootRef.current
        if (root && action(root)) emitChange()
      },
      [emitChange],
    )

    React.useImperativeHandle(
      ref,
      () => ({
        applyMark: (tag) => runAction((r) => applyInlineMark(r, tag)),
        applyToken: (token) => runAction((r) => applyToken(r, token)),
        insertHeading: () => runAction((r) => insertHeading(r)),
        clearFormatting: () => runAction((r) => clearFormatting(r)),
        clearColor: () => runAction((r) => clearColor(r)),
        insertAround: (before, after) => runAction((r) => insertAround(r, before, after)),
        focus: () => rootRef.current?.focus(),
      }),
      [runAction],
    )

    const handlers = useEditorHandlers(rootRef, composingRef, emitChange)

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
        onInput={handlers.handleInput}
        onPaste={handlers.handlePaste}
        onDrop={handlers.handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onKeyDown={handlers.handleKeyDown}
        onCompositionStart={handlers.handleCompositionStart}
        onCompositionEnd={handlers.handleCompositionEnd}
      />
    )
  },
)

WysiwygEditor.displayName = 'WysiwygEditor'
