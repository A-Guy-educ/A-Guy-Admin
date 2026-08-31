'use client'

import React, { useEffect, useRef, useState } from 'react'
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
 *
 * IMPORTANT — content freeze at mount:
 * The `blocks` prop is snapshotted into local state at mount and NEVER
 * refreshed from subsequent prop changes. This is deliberate. The studio's
 * parent re-renders constantly (Save-all toggling `saving`, row-op state
 * churn, refetch cycles); if we forwarded the live `blocks` prop to
 * FullJsonEditor, its own `useEffect(() => setJsonText(...), [content])`
 * would wipe any in-progress textarea edit on every ancestor re-render.
 * Snapshotting also stabilizes the invariance baseline so it can't drift
 * mid-session from a concurrent refetch normalizing the container's blocks.
 */
export const StudioBlocksJsonModal: React.FC<StudioBlocksJsonModalProps> = ({
  blocks,
  label,
  onApply,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)

  // One-shot capture: useState with an initializer runs exactly once.
  // Later prop changes to `blocks` are intentionally ignored (see above).
  const [frozenContent] = useState<{ blocks: ContentBlock[] }>(() => ({ blocks }))

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
    // FullJsonEditor's structural-invariance check guarantees `updated` is
    // shape-compatible with `frozenContent` (which is `{ blocks: [...] }`)
    // before it fires this callback, so the cast is safe.
    onApply((updated as { blocks: ContentBlock[] }).blocks)
    onClose()
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
          content={frozenContent}
          originalContent={frozenContent}
          onApply={handleApply}
          onCancel={onClose}
        />
      </div>
    </div>
  )
}
