import React from 'react'
import { currentRange } from './wysiwyg-dom'

interface HandlerBundle {
  handleInput: (e: React.FormEvent<HTMLDivElement>) => void
  handlePaste: (e: React.ClipboardEvent<HTMLDivElement>) => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  handleCompositionStart: () => void
  handleCompositionEnd: () => void
}

/**
 * Native-event glue for the WysiwygEditor's contentEditable surface. Kept
 * separate from the component so the JSX reads as intent.
 *
 * - handleInput suppresses serialize during IME composition (Hebrew nikud,
 *   CJK) so intermediate text doesn't flicker and jump the caret.
 * - handlePaste coerces clipboard to plain text — an `<img onerror=…>` would
 *   otherwise fire in the admin origin before we serialize the DOM away.
 * - handleKeyDown routes Shift+Enter to a hard paragraph split (md-math-v1
 *   has no soft-break marker, so a <br> would drift to a paragraph on the
 *   next hydrate) and swallows Ctrl+U (serializer would discard the <u>).
 */
export function useEditorHandlers(
  rootRef: React.RefObject<HTMLDivElement | null>,
  composingRef: React.MutableRefObject<boolean>,
  emitChange: () => void,
): HandlerBundle {
  const handleInput = React.useCallback(
    (e: React.FormEvent<HTMLDivElement>) => {
      if (composingRef.current || (e.nativeEvent as InputEvent).isComposing) return
      emitChange()
    },
    [composingRef, emitChange],
  )

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
    [rootRef, composingRef, emitChange],
  )

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      if (typeof document.execCommand === 'function') document.execCommand('insertParagraph')
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) e.preventDefault()
  }, [])

  const handleCompositionStart = React.useCallback(() => {
    composingRef.current = true
  }, [composingRef])

  const handleCompositionEnd = React.useCallback(() => {
    composingRef.current = false
    emitChange()
  }, [composingRef, emitChange])

  return { handleInput, handlePaste, handleKeyDown, handleCompositionStart, handleCompositionEnd }
}
