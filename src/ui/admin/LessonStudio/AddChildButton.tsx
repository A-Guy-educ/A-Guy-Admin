'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

interface AddChildButtonProps {
  /** Label shown on the collapsed button, e.g. "Add section". */
  label: string
  /** Placeholder shown in the expanded input. */
  placeholder: string
  /**
   * Called with the trimmed title (or empty string — the server falls back
   * to a placeholder) when the user submits. Return the promise so the
   * button can show a busy state and reset on completion.
   */
  onSubmit: (title: string) => Promise<void>
}

/**
 * "+ Add X" button that expands inline to a name input on click. Used for
 * both section-under-exercise and exercise-under-lesson creation. Kept
 * lightweight (no popover, no dialog) so it feels like a document affordance
 * rather than a modal — same feel as the boss's Word-style demo.
 */
export const AddChildButton: React.FC<AddChildButtonProps> = ({ label, placeholder, onSubmit }) => {
  const [expanded, setExpanded] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  const cancel = useCallback(() => {
    setExpanded(false)
    setValue('')
  }, [])

  const submit = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onSubmit(value.trim())
      setValue('')
      setExpanded(false)
    } finally {
      setBusy(false)
    }
  }, [busy, onSubmit, value])

  if (!expanded) {
    return (
      <button type="button" className="studio-add-btn" onClick={() => setExpanded(true)}>
        <span aria-hidden="true">+</span> {label}
      </button>
    )
  }

  return (
    <div className="studio-add-form">
      <input
        ref={inputRef}
        type="text"
        className="studio-add-input"
        placeholder={placeholder}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
      />
      <button
        type="button"
        className="studio-add-submit-btn"
        onClick={() => void submit()}
        disabled={busy}
      >
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button type="button" className="studio-add-cancel-btn" onClick={cancel} disabled={busy}>
        Cancel
      </button>
    </div>
  )
}
