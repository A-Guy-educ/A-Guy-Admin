'use client'

/**
 * EditorChromeContext — lets a host (e.g. Lesson Studio) tell the shared
 * block editors to fold their form chrome, without any host-specific coupling
 * in the editors.
 *
 * Consumers read via `useEditorChrome()`; the default returned when there is
 * no provider preserves the stock admin behavior (full chrome).
 */
import React from 'react'

export type EditorChromeMode = 'expanded' | 'compact'

export interface EditorChromeValue {
  mode: EditorChromeMode
}

const defaultValue: EditorChromeValue = {
  mode: 'expanded',
}

const EditorChromeContext = React.createContext<EditorChromeValue>(defaultValue)

export const EditorChromeProvider: React.FC<{
  mode?: EditorChromeMode
  children: React.ReactNode
}> = ({ mode, children }) => {
  const value = React.useMemo<EditorChromeValue>(
    () => ({
      mode: mode ?? defaultValue.mode,
    }),
    [mode],
  )
  return <EditorChromeContext.Provider value={value}>{children}</EditorChromeContext.Provider>
}

export function useEditorChrome(): EditorChromeValue {
  return React.useContext(EditorChromeContext)
}
