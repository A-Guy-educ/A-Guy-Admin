'use client'

import React, { useEffect, useRef } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { JSONInspector } from '../ExerciseContentEditor/JSONInspector'

interface StudioBlockJsonModalProps {
  block: ContentBlock
  onApply: (updated: ContentBlock) => void
  onClose: () => void
}

/**
 * Full-JSON view/edit modal for a single studio block. Mirrors the JSON
 * inspector that lives in the side panel on the exercise/section doc pages,
 * but wrapped in an overlay because the studio has no persistent side rail.
 *
 * The JSON inspector itself owns the enter-edit → validate → apply flow;
 * this component only handles the overlay + Escape/backdrop close so the
 * studio call sites stay simple.
 */
export const StudioBlockJsonModal: React.FC<StudioBlockJsonModalProps> = ({
  block,
  onApply,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleApply = (updated: ContentBlock) => {
    onApply(updated)
    onClose()
  }

  return (
    <div
      className="studio-json-modal-overlay"
      onClick={(e) => {
        // Backdrop click closes; inner content clicks stop-propagate below.
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Edit block JSON"
    >
      <div ref={dialogRef} className="studio-json-modal" onClick={(e) => e.stopPropagation()}>
        <JSONInspector block={block} mode="edit" onApply={handleApply} onClose={onClose} />
      </div>
    </div>
  )
}
