'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, Loader2, X } from 'lucide-react'
import { useDebounce } from '@/client/hooks/useDebounce'

interface SelectedRef {
  refId: string
  blockType: 'exerciseRef' | 'contentPageRef'
}

interface TransferExercisesModalProps {
  sourceLessonId: string
  selectedRefs: SelectedRef[]
  onClose: () => void
  /**
   * Fires after any ref successfully transferred. Receives the list of
   * refs the server confirmed were moved so the parent can surgically
   * remove them from local form state (preserving other unsaved edits
   * — title, chapter, reorderings of the remaining blocks).
   */
  onTransferred: (successes: SelectedRef[]) => void
}

interface LessonOption {
  id: string
  title: string
  chapterTitle?: string
}

interface TransferFailure {
  refId: string
  blockType?: 'exerciseRef' | 'contentPageRef'
  error: string
}

interface TransferResultSummary {
  transferred: number
  failed: number
  failures?: TransferFailure[]
  needsReload?: boolean
  reloadReason?: string
}

export const TransferExercisesModal: React.FC<TransferExercisesModalProps> = ({
  sourceLessonId,
  selectedRefs,
  onClose,
  onTransferred,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Re-entry guard: setState is async, so two synchronous click events (double
  // click, keyboard+mouse in the same tick) can both pass the isTransferring
  // check before React commits the state update.
  const transferInFlightRef = useRef(false)
  // Reload timeout handle so unmount cancels a pending window.location.reload
  // (admin closed the modal before the 2.5s message window elapsed).
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<LessonOption[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [selectedLesson, setSelectedLesson] = useState<LessonOption | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransferResultSummary | null>(null)
  const debouncedQuery = useDebounce(searchQuery, 300)

  useEffect(() => {
    return () => {
      if (reloadTimeoutRef.current !== null) {
        clearTimeout(reloadTimeoutRef.current)
        reloadTimeoutRef.current = null
      }
    }
  }, [])

  // Escape to close (blocked while transfer is in flight). Routing through the
  // close callback below is deferred until after it's declared.
  const closeRef = useRef<() => void>(() => {})
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTransferring) closeRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isTransferring])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement
    dialogRef.current?.focus()
    return () => {
      const prev = previouslyFocusedRef.current
      if (prev instanceof HTMLElement) prev.focus()
    }
  }, [])

  // Lesson search
  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setResults([])
      setIsDropdownOpen(false)
      return
    }

    let cancelled = false
    async function search() {
      setIsSearching(true)
      try {
        const url = `/api/lessons?where[title][contains]=${encodeURIComponent(debouncedQuery)}&where[id][not_equals]=${encodeURIComponent(sourceLessonId)}&limit=10&depth=1`
        const res = await fetch(url, { credentials: 'include' })
        if (!res.ok) {
          if (!cancelled) setResults([])
          return
        }
        const data = await res.json()
        const lessons: LessonOption[] = (data.docs ?? [])
          .filter((doc: { id: string }) => doc.id !== sourceLessonId)
          .map((doc: { id: string; title: string; chapter?: { title?: string } }) => ({
            id: doc.id,
            title: doc.title,
            chapterTitle: doc.chapter?.title,
          }))
        if (!cancelled) {
          setResults(lessons)
          setIsDropdownOpen(lessons.length > 0)
        }
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setIsSearching(false)
      }
    }
    void search()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, sourceLessonId])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePickLesson = useCallback((lesson: LessonOption) => {
    setSelectedLesson(lesson)
    setSearchQuery(lesson.title)
    setIsDropdownOpen(false)
    setError(null)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedLesson(null)
    setSearchQuery('')
    setResults([])
  }, [])

  const handleTransfer = useCallback(async () => {
    if (!selectedLesson || selectedRefs.length === 0) return
    if (transferInFlightRef.current) return
    transferInFlightRef.current = true
    setIsTransferring(true)
    setError(null)
    setResult(null)
    try {
      // Defensive client-side dedupe. The parent builds selectedRefs by
      // iterating selected block.ids, so if a lesson has two different
      // block entries pointing at the same (blockType, refId) (legacy
      // imports), both land here as duplicates. The server's Zod guard
      // would 400 the whole batch — dedupe here so a legacy-data case
      // doesn't surface as an opaque validation error.
      const dedupedRefs = Array.from(
        new Map(selectedRefs.map((r) => [`${r.blockType}::${r.refId}`, r])).values(),
      )
      const res = await fetch('/api/lessons/transfer-blocks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceLessonId,
          targetLessonId: selectedLesson.id,
          refs: dedupedRefs,
        }),
      })
      const envelope = await res.json()
      if (!res.ok || envelope.error) {
        setError(envelope.error?.message || `HTTP ${res.status}`)
        return
      }
      const data = envelope.data || {}
      const summary: TransferResultSummary = {
        transferred: data.transferred ?? 0,
        failed: data.failed ?? 0,
        failures: data.failures,
        needsReload: Boolean(data.needsReload),
        reloadReason: data.reloadReason,
      }
      setResult(summary)
      // Server reports inconsistent state (ref docs updated but a lesson
      // playlist rewrite failed) — local pruning would silently re-attach
      // the moved refs on next Save. Force a full reload so the admin sees
      // canonical server state. Delay briefly so the message is readable.
      if (summary.needsReload) {
        reloadTimeoutRef.current = setTimeout(() => window.location.reload(), 2500)
        return
      }
      // Compute successes = selectedRefs − failures and hand them to the
      // parent so it can prune its local blocks state. Doing this instead
      // of a hard reload preserves other unsaved field edits on the lesson.
      // Match against the full selectedRefs set (not the deduped list) so
      // the parent removes every local block entry that points at a moved
      // ref, even if the ref had duplicate block rows.
      const failedKeys = new Set(
        (summary.failures ?? []).map((f) => `${f.blockType ?? 'exerciseRef'}::${f.refId}`),
      )
      const successes = selectedRefs.filter((r) => !failedKeys.has(`${r.blockType}::${r.refId}`))
      if (successes.length > 0) {
        onTransferred(successes)
        // Full success → auto-close. Partial → keep modal open so the admin
        // can read the per-ref failure list before closing manually.
        if (summary.failed === 0) onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setIsTransferring(false)
      transferInFlightRef.current = false
    }
  }, [selectedLesson, selectedRefs, sourceLessonId, onTransferred, onClose])

  const canTransfer = Boolean(selectedLesson && !isTransferring && selectedRefs.length > 0)

  const handleClose = useCallback(() => {
    if (isTransferring) return
    onClose()
  }, [isTransferring, onClose])
  closeRef.current = handleClose

  return (
    <div
      className="import-exercises-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Transfer selected items to another lesson"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
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
            <ArrowRightLeft size={16} /> Transfer {selectedRefs.length}{' '}
            {selectedRefs.length === 1 ? 'item' : 'items'} to another lesson
          </h3>
          <button
            type="button"
            className="import-exercises-close"
            onClick={handleClose}
            disabled={isTransferring}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <p className="import-exercises-hint">
          Pick a destination lesson. The selected items will be moved out of this lesson and into
          the one you choose. Your other unsaved edits are preserved.
        </p>

        <div className="transfer-lesson-picker" ref={containerRef}>
          <label htmlFor="transfer-lesson-search" className="transfer-lesson-picker-label">
            Destination lesson
          </label>
          <input
            id="transfer-lesson-search"
            type="text"
            className="transfer-lesson-picker-input"
            placeholder="Search lessons by title…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (selectedLesson) setSelectedLesson(null)
              setIsDropdownOpen(true)
            }}
            onFocus={() => {
              if (results.length > 0) setIsDropdownOpen(true)
            }}
            disabled={isTransferring}
            autoComplete="off"
          />
          {isSearching && <div className="transfer-lesson-picker-status">Searching…</div>}
          {isDropdownOpen && results.length > 0 && (
            <ul className="transfer-lesson-picker-dropdown">
              {results.map((lesson) => (
                <li
                  key={lesson.id}
                  className="transfer-lesson-picker-item"
                  onClick={() => handlePickLesson(lesson)}
                >
                  <div className="transfer-lesson-picker-item-title">{lesson.title}</div>
                  {lesson.chapterTitle && (
                    <div className="transfer-lesson-picker-item-chapter">{lesson.chapterTitle}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {selectedLesson && (
            <div className="transfer-lesson-picker-selected">
              Selected: <strong>{selectedLesson.title}</strong>
              {!isTransferring && (
                <button
                  type="button"
                  className="transfer-lesson-picker-clear"
                  onClick={handleClearSelection}
                >
                  change
                </button>
              )}
            </div>
          )}
        </div>

        {error && <div className="import-exercises-error">{error}</div>}

        {result?.needsReload && (
          <div className="import-exercises-error">
            Server state is inconsistent — {result.transferred} ref doc(s) were moved but the lesson
            playlist rewrite failed. Reloading in a moment to recover canonical state…
            {result.reloadReason && (
              <div style={{ marginTop: 6, fontSize: 11, opacity: 0.8 }}>{result.reloadReason}</div>
            )}
          </div>
        )}

        {result && !result.needsReload && (
          <div
            className={result.failed > 0 ? 'import-exercises-error' : 'import-exercises-success'}
          >
            {result.failed > 0 ? (
              <>
                <div>
                  Transferred {result.transferred}, {result.failed} failed. The {result.transferred}{' '}
                  that moved have been removed from this lesson&apos;s playlist locally.
                </div>
                {result.failures && result.failures.length > 0 && (
                  <ul className="transfer-failures-list">
                    {result.failures.slice(0, 5).map((f, i) => (
                      <li key={`${f.refId}-${i}`}>
                        <code>{f.refId.slice(0, 8)}…</code> — {f.error}
                      </li>
                    ))}
                    {result.failures.length > 5 && <li>…and {result.failures.length - 5} more</li>}
                  </ul>
                )}
              </>
            ) : (
              `Transferred ${result.transferred} item(s).`
            )}
          </div>
        )}

        <footer className="import-exercises-footer">
          <button
            type="button"
            className="import-exercises-secondary"
            onClick={handleClose}
            disabled={isTransferring}
          >
            {result && result.transferred > 0 ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="import-exercises-primary"
            onClick={handleTransfer}
            disabled={!canTransfer || Boolean(result)}
          >
            {isTransferring ? (
              <>
                <Loader2 size={14} className="import-exercises-spin" /> Transferring…
              </>
            ) : (
              'Transfer'
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
