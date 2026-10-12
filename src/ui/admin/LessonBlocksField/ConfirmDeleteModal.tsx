'use client'

import React, { useEffect, useRef } from 'react'
import { Trash2, X } from 'lucide-react'

interface ConfirmDeleteModalProps {
  exerciseCount: number
  contentPageCount: number
  deleting?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

function formatSummary(exerciseCount: number, contentPageCount: number): string {
  const parts: string[] = []
  if (exerciseCount > 0)
    parts.push(`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'} (and their sections)`)
  if (contentPageCount > 0)
    parts.push(`${contentPageCount} content page${contentPageCount === 1 ? '' : 's'}`)
  return parts.join(' + ')
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  exerciseCount,
  contentPageCount,
  deleting = false,
  error = null,
  onCancel,
  onConfirm,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)
  const total = exerciseCount + contentPageCount

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel, deleting])

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
      aria-label="Confirm permanent delete"
      onClick={(e) => {
        if (deleting) return
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
            <Trash2 size={16} /> Permanently delete selected
          </h3>
          <button
            type="button"
            className="import-exercises-close"
            onClick={onCancel}
            disabled={deleting}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <p className="import-exercises-hint">
          You&apos;re about to permanently delete{' '}
          <strong>{formatSummary(exerciseCount, contentPageCount)}</strong>. This also removes each
          item from this lesson&apos;s playlist and <strong>can&apos;t be undone</strong>. To move
          items to a different lesson instead, use <em>Transfer</em>.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--theme-error-700, #b91c1c)',
              background: 'var(--theme-error-50, #fef2f2)',
              border: '1px solid var(--theme-error-200, #fecaca)',
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        <footer className="import-exercises-footer">
          <button
            type="button"
            className="import-exercises-secondary"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-delete-primary"
            onClick={onConfirm}
            disabled={deleting || total === 0}
          >
            {deleting ? 'Deleting…' : `Delete ${total}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
