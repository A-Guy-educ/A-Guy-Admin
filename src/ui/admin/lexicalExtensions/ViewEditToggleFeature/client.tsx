/**
 * @fileType client-feature
 * @domain payload
 * @pattern lexical-feature
 * @ai-summary Client feature for the View/Edit mode toggle button.
 *
 * Adds a single dropdown toolbar group with two items ("View" and "Edit").
 * Only one item is marked active at a time — the one that represents the
 * NEXT action to perform (so the currently-active label tells the editor
 * "click me to switch"). Clicking either item calls `editor.setEditable()`
 * to flip the read-only state, which Payload's fixed and inline toolbars
 * react to by hiding themselves, satisfying the "view mode hides toolbar"
 * acceptance criterion.
 */
'use client'

import type { LexicalEditor } from '@payloadcms/richtext-lexical/lexical'
import { createClientFeature } from '@payloadcms/richtext-lexical/client'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useEffect, useState } from 'react'

type ClientToolbarItem = {
  isActive?: (args: { editor: LexicalEditor }) => boolean
  key: string
  label: string
  onSelect?: (args: { editor: LexicalEditor }) => void
}

type ClientToolbarGroup = {
  items: ClientToolbarItem[]
  key: string
  order: number
  type: 'dropdown'
}

const toggleEditMode = ({ editor }: { editor: LexicalEditor }) => {
  editor.setEditable(!editor.isEditable())
}

const makeToolbarItem = (mode: 'view' | 'edit'): ClientToolbarItem => ({
  isActive: ({ editor }: { editor: LexicalEditor }) =>
    mode === 'view' ? editor.isEditable() : !editor.isEditable(),
  key: mode,
  label: mode === 'view' ? 'View' : 'Edit',
  onSelect: toggleEditMode,
})

// Forces the toolbar buttons (which read `editor.isEditable()` synchronously)
// to re-evaluate whenever the editable state flips. Without this the active
// styling only updates when the toolbar is otherwise re-rendered.
const EditableStatePlugin = () => {
  const [editor] = useLexicalComposerContext()
  const [, force] = useState(0)

  useEffect(() => {
    return editor.registerEditableListener(() => {
      force((value) => value + 1)
    })
  }, [editor])

  return null
}

const buildGroup = (): ClientToolbarGroup => ({
  items: [makeToolbarItem('view'), makeToolbarItem('edit')],
  key: 'viewEditToggle',
  order: 1,
  type: 'dropdown',
})

export const ViewEditToggleFeatureClient = createClientFeature(() => ({
  plugins: [
    {
      Component: EditableStatePlugin,
      position: 'normal' as const,
    },
  ],
  toolbarFixed: { groups: [buildGroup()] },
  toolbarInline: { groups: [buildGroup()] },
}))
