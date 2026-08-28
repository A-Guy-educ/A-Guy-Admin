'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { ExerciseBlockDefaults } from '@/server/payload/collections/Exercises/defaults'

interface AddBlockButtonProps {
  onAdd: (block: ContentBlock) => void
}

// Curated menu of block types that make sense from the studio. Advanced
// graph blocks (geometry, axis, multi-axis, table, matching, svg, media)
// require complex specs — admins open the exercise/section doc page (via
// the "Open ↗" links) to add those and paste the raw JSON.
const STUDIO_BLOCK_MENU: ReadonlyArray<{ key: keyof typeof ExerciseBlockDefaults; label: string }> =
  [
    { key: 'rich_text', label: 'Rich text' },
    { key: 'question_mcq', label: 'Multiple choice' },
    { key: 'question_select', label: 'True / False' },
    { key: 'question_free_response', label: 'Free response' },
    { key: 'latex', label: 'LaTeX' },
    { key: 'html', label: 'HTML' },
  ]

/**
 * Inline "+ Add block" button that opens a small popover of block types.
 * Selecting a type calls `onAdd` with a freshly-built block from the shared
 * `ExerciseBlockDefaults` factory — the parent decides where the block goes
 * (appended to a section's or exercise's `content.blocks`).
 */
export const AddBlockButton: React.FC<AddBlockButtonProps> = ({ onAdd }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const root = rootRef.current
      if (!root || (e.target instanceof Node && root.contains(e.target))) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handlePick = useCallback(
    (key: keyof typeof ExerciseBlockDefaults) => {
      const factory = ExerciseBlockDefaults[key]
      if (!factory) return
      onAdd(factory())
      setOpen(false)
    },
    [onAdd],
  )

  return (
    <div ref={rootRef} className="studio-add-wrapper">
      <button
        type="button"
        className="studio-add-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true">+</span> Add block
      </button>
      {open && (
        <div className="studio-add-menu" role="menu">
          {STUDIO_BLOCK_MENU.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="menuitem"
              className="studio-add-menu-item"
              onClick={() => handlePick(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
