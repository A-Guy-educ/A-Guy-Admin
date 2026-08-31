'use client'

import React, { useEffect, useRef } from 'react'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { FullJsonEditor } from '../ExerciseContentEditor/FullJsonEditor'

interface StudioBlocksJsonModalProps {
  /** The current blocks array — becomes the initial and baseline content. */
  blocks: ContentBlock[]
  /** Human-readable label for the modal (e.g. section title). */
  label?: string
  onApply: (updated: ContentBlock[]) => void
  onClose: () => void
}

/**
 * Full-JSON view/edit modal for a group of blocks (all blocks in a section,
 * or the exercise-level content blocks). Wraps the existing FullJsonEditor
 * which enforces structural invariance — same rules as the exercise-doc
 * page's Full JSON button, so admins can grab the whole array, tweak values
 * inside existing blocks, and paste back without corrupting schema.
 *
 * Adding / removing blocks or changing a block's id/type is blocked by
 * design — use the studio's per-block Add / Delete affordances for that.
 */
export const StudioBlocksJsonModal: React.FC<StudioBlocksJsonModalProps> = ({
  blocks,
  label,
  onApply,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)

  // Snapshot the blocks at mount so structural-invariance validation compares
  // against the state the admin opened, not against every keystroke re-render.
  // Ref (not state) so it's captured once and never re-triggers.
  const originalContentRef = useRef<{ blocks: ContentBlock[] }>({ blocks })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    dialogRef.current?.focus()
    return () => {
      const prev = previouslyFocusedRef.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [])

  const handleApply = (updated: unknown) => {
    // FullJsonEditor hands back the whole `content` object — pull the blocks
    // array out and hand only that to the studio parent, which manages the
    // dirty flag + save-batch.
    if (
      updated &&
      typeof updated === 'object' &&
      'blocks' in updated &&
      Array.isArray((updated as { blocks: unknown }).blocks)
    ) {
      onApply((updated as { blocks: ContentBlock[] }).blocks)
      onClose()
    }
  }

  return (
    <div
      className="studio-json-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label ? `Edit JSON for ${label}` : 'Edit blocks JSON'}
    >
      <div
        ref={dialogRef}
        className="studio-json-modal studio-json-modal--wide"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <FullJsonEditor
          content={{ blocks }}
          originalContent={originalContentRef.current}
          onApply={handleApply}
          onCancel={onClose}
        />
      </div>
    </div>
  )
}
