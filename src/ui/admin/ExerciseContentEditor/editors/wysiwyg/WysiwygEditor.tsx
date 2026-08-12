'use client'

import React from 'react'
import type { AllToken } from './wysiwyg-tokens'
import { parseMdToHtml } from './wysiwyg-parse'
import { serializeDomToMd } from './wysiwyg-serialize'
import { currentRange } from './wysiwyg-dom'
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

// Sentinel so the first render always hydrates (one effect covers mount + updates).
const UNHYDRATED: unique symbol = Symbol('unhydrated')

/**
 * Contenteditable surface that renders md-math-v1 as live-formatted HTML.
 * Toolbar actions mutate the DOM via the imperative handle; input events
 * serialize back to md. We only re-hydrate innerHTML when the external value
 * diverges from what we last emitted — otherwise every keystroke would reset
 * the caret to the top.
 */
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

    const runAction = React.useCallback(
      (action: (root: HTMLElement) => boolean) => {
        const root = rootRef.current
        if (!root) return
        // Skip the onChange (and dirty-flag flip) if the action was a no-op
        // — clicking Bold with a bare caret shouldn't wake up autosave.
        if (action(root)) emitChange()
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
        insertAround: (before, after) => runAction((r) => insertAround(r, before, after)),
        focus: () => rootRef.current?.focus(),
      }),
      [runAction],
    )

    // Force paste to plain text — a contentEditable otherwise accepts HTML
    // like `<img onerror=…>` which runs JS in the admin origin before we get
    // to serialize the DOM back to md.
    const handlePaste = React.useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault()
        if (composingRef.current) return
        const root = rootRef.current
        if (!root) return
        const text = e.clipboardData.getData('text/plain')
        if (!text) return
        const range = currentRange(root)
        if (!range) return
        range.deleteContents()
        range.insertNode(document.createTextNode(text))
        range.collapse(false)
        emitChange()
      },
      [emitChange],
    )

    // Suppress serialize during IME composition (Hebrew nikud, CJK) — the
    // browser is still writing intermediate text and re-serializing mid-
    // stream causes visible flicker and caret jumps.
    const handleInput = React.useCallback(
      (e: React.FormEvent<HTMLDivElement>) => {
        if (composingRef.current || (e.nativeEvent as InputEvent).isComposing) return
        emitChange()
      },
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
        onInput={handleInput}
        onPaste={handlePaste}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          emitChange()
        }}
      />
    )
  },
)

WysiwygEditor.displayName = 'WysiwygEditor'
