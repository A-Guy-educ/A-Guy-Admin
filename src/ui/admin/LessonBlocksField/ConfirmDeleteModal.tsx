'use client'

import React, { useEffect, useRef } from 'react'
import { Trash2, X } from 'lucide-react'

interface ConfirmDeleteModalProps {
  count: number
  onCancel: () => void
  onConfirm: () => void
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  count,
  onCancel,
  onConfirm,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    dialogRef.current?.focus()
    return () => {
      const prev = previouslyFocusedRef.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [])

  return (
    <div
      className="import-exercises-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm removal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="import-exercises-modal confirm-delete-modal"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="import-exercises-header">
          <h3 className="import-exercises-title">
            <Trash2 size={16} /> Remove selected from playlist
          </h3>
          <button
            type="button"
            className="import-exercises-close"
            onClick={onCancel}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <p className="import-exercises-hint">
          Are you sure you want to remove <strong>{count}</strong> {count === 1 ? 'item' : 'items'}{' '}
          from this lesson&apos;s playlist? The underlying exercises and content pages will still
          exist — you&apos;re only removing them from this lesson&apos;s ordering. Save the lesson
          to persist the change.
        </p>

        <footer className="import-exercises-footer">
          <button type="button" className="import-exercises-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm-delete-primary" onClick={onConfirm}>
            Remove {count}
          </button>
        </footer>
      </div>
    </div>
  )
}
