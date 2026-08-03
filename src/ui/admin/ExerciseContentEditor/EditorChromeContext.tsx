'use client'

/**
 * EditorChromeContext — lets a host (e.g. Lesson Studio) tell the shared
 * block editors to fold their form chrome and default rich-text blocks to
 * rendered-preview mode, without any host-specific coupling in the editors.
 *
 * Consumers read via `useEditorChrome()`; the default returned when there is
 * no provider preserves the stock admin behavior (full chrome, edit mode).
 */
import React from 'react'

export type EditorChromeMode = 'expanded' | 'compact'
export type RichTextInitialMode = 'edit' | 'view'

export interface EditorChromeValue {
  mode: EditorChromeMode
  defaultRichTextView: RichTextInitialMode
}

const defaultValue: EditorChromeValue = {
  mode: 'expanded',
  defaultRichTextView: 'edit',
}

const EditorChromeContext = React.createContext<EditorChromeValue>(defaultValue)

export const EditorChromeProvider: React.FC<{
  mode?: EditorChromeMode
  defaultRichTextView?: RichTextInitialMode
  children: React.ReactNode
}> = ({ mode, defaultRichTextView, children }) => {
  const value = React.useMemo<EditorChromeValue>(
    () => ({
      mode: mode ?? defaultValue.mode,
      defaultRichTextView: defaultRichTextView ?? defaultValue.defaultRichTextView,
    }),
    [mode, defaultRichTextView],
  )
  return <EditorChromeContext.Provider value={value}>{children}</EditorChromeContext.Provider>
}

export function useEditorChrome(): EditorChromeValue {
  return React.useContext(EditorChromeContext)
}
