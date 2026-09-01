'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileUp, Loader2, X } from 'lucide-react'

interface ImportExercisesModalProps {
  lessonId: string
  onClose: () => void
  /** Fires after a successful import so the parent can trigger a page refresh. */
  onImported: () => void
}

interface ImportResultSummary {
  exercisesCreated: number
  exercisesFailed: number
  results?: Array<{ exerciseNumber?: string | number; error?: string }>
}

type ImportFormat = 'json' | 'text'

interface StagedFile {
  filename: string
  format: ImportFormat
  text: string
  json: unknown
  parseError?: string
}

/**
 * Modal that lets an admin upload a .json or .txt lesson file (same format
 * accepted by /admin/lesson-json-import) and append its exercises to the
 * currently-open lesson doc. Wraps the existing import services — the only
 * new payload field is `targetLessonId`.
 */
export const ImportExercisesModal: React.FC<ImportExercisesModalProps> = ({
  lessonId,
  onClose,
  onImported,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)
  const [staged, setStaged] = useState<StagedFile | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResultSummary | null>(null)

  // Escape to close (blocked while an import is running so a mis-tap can't
  // abandon a mid-flight request).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isImporting) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, isImporting])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    dialogRef.current?.focus()
    return () => {
      const prev = previouslyFocusedRef.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [])

  const handleFileSelected = useCallback(async (file: File) => {
    setError(null)
    setResult(null)
    const text = await file.text()
    const isJson = file.name.toLowerCase().endsWith('.json')
    if (isJson) {
      try {
        const json = JSON.parse(text)
        setStaged({ filename: file.name, format: 'json', text, json })
      } catch (err) {
        setStaged({
          filename: file.name,
          format: 'json',
          text,
          json: null,
          parseError: err instanceof Error ? err.message : 'Invalid JSON',
        })
      }
    } else {
      setStaged({ filename: file.name, format: 'text', text, json: null })
    }
  }, [])

  const handleImport = useCallback(async () => {
    if (!staged || staged.parseError) return
    setIsImporting(true)
    setError(null)
    setResult(null)
    try {
      const url =
        staged.format === 'json' ? '/api/lessons/import-from-json' : '/api/lessons/import-from-text'
      const body =
        staged.format === 'json'
          ? { targetLessonId: lessonId, filename: staged.filename, json: staged.json }
          : { targetLessonId: lessonId, filename: staged.filename, text: staged.text }
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const envelope = await res.json()
      if (!res.ok || envelope.error) {
        const message =
          envelope.error?.message ||
          (envelope.error?.details?.issues
            ? envelope.error.details.issues.join('; ')
            : `HTTP ${res.status}`)
        setError(message)
        return
      }
      const data = envelope.data || {}
      setResult({
        exercisesCreated: data.exercisesCreated ?? 0,
        exercisesFailed: data.exercisesFailed ?? 0,
        results: data.results,
      })
      if ((data.exercisesFailed ?? 0) === 0 && (data.exercisesCreated ?? 0) > 0) {
        onImported()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setIsImporting(false)
    }
  }, [staged, lessonId, onImported])

  const canImport = Boolean(staged && !staged.parseError && !isImporting)

  return (
    <div
      className="import-exercises-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Import exercises into this lesson"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="import-exercises-modal"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="import-exercises-header">
          <h3 className="import-exercises-title">
            <FileUp size={16} /> Import exercises into this lesson
          </h3>
          <button
            type="button"
            className="import-exercises-close"
            onClick={onClose}
            disabled={isImporting}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <p className="import-exercises-hint">
          Upload a <code>.txt</code> or <code>.json</code> lesson file — the same format the
          full-lesson importer accepts. Exercises will be appended to this lesson&apos;s playlist,
          nothing existing is removed.
        </p>

        <label className="import-exercises-dropzone">
          <input
            type="file"
            accept=".txt,.json,text/plain,application/json"
            className="import-exercises-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFileSelected(file)
            }}
            disabled={isImporting}
          />
          <span>
            {staged ? (
              <>
                <strong>{staged.filename}</strong>
                <span className="import-exercises-dropzone-fmt">
                  {' '}
                  ({staged.format.toUpperCase()})
                </span>
              </>
            ) : (
              'Choose file…'
            )}
          </span>
        </label>

        {staged?.parseError && (
          <div className="import-exercises-error">JSON parse error: {staged.parseError}</div>
        )}

        {error && <div className="import-exercises-error">{error}</div>}

        {result && (
          <div
            className={
              result.exercisesFailed > 0 ? 'import-exercises-error' : 'import-exercises-success'
            }
          >
            {result.exercisesFailed > 0
              ? `Rolled back — ${result.exercisesFailed} exercise(s) failed. First error: ${result.results?.find((r) => r?.error)?.error ?? 'unknown'}`
              : `Imported ${result.exercisesCreated} exercise(s). Reloading…`}
          </div>
        )}

        <footer className="import-exercises-footer">
          <button
            type="button"
            className="import-exercises-secondary"
            onClick={onClose}
            disabled={isImporting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="import-exercises-primary"
            onClick={handleImport}
            disabled={!canImport}
          >
            {isImporting ? (
              <>
                <Loader2 size={14} className="import-exercises-spin" /> Importing…
              </>
            ) : (
              'Import'
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
