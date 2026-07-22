'use client'

/**
 * CourseDuplicateButton — admin "Duplicate" action on the course edit view.
 *
 * @fileType component
 * @domain courses
 * @pattern admin-action-modal
 * @ai-summary Opens a confirmation modal, then POSTs to /api/courses/:id/duplicate-course.
 *
 * Unlike the lesson duplication button, this action has no variation level —
 * course duplication always performs a `none`-level deep clone of the course
 * and every nested chapter / lesson / exercise / section. The modal exists so
 * admins confirm intent (this can create hundreds of rows) and can see the
 * resulting counts once the clone finishes.
 *
 * Modal close is guarded while the fetch is in flight: the request can't be
 * cancelled server-side, and closing early throws away the result counts + the
 * "Open the new course" link the admin would need to find the new course.
 */
import React, { useEffect, useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

type Status = 'idle' | 'submitting' | 'success' | 'error'

interface DuplicateResponse {
  outputCourseId?: string
  counts?: {
    chaptersCloned: number
    chaptersFailed: number
    lessonsCloned: number
    lessonsFailed: number
    exercisesCloned: number
    exercisesFailed: number
    sectionsCloned: number
    sectionsFailed: number
  }
  error?: string
}

const DIALOG_TITLE_ID = 'course-duplicate-modal-title'

export const CourseDuplicateAction: React.FC = () => {
  const { id } = useDocumentInfo()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DuplicateResponse | null>(null)

  // Escape-to-close while the modal is open — but only when a request isn't in
  // flight. Closing mid-submit would drop the result counts + link to the new
  // course, and the server-side clone can't be cancelled anyway.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (status === 'submitting') return
      setOpen(false)
      setStatus('idle')
      setError(null)
      setResult(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, status])

  if (!id) return null

  const reset = () => {
    setStatus('idle')
    setError(null)
    setResult(null)
  }

  const close = () => {
    if (status === 'submitting') return
    setOpen(false)
    reset()
  }

  const submit = async () => {
    setStatus('submitting')
    setError(null)
    try {
      const res = await fetch(`/api/courses/${id}/duplicate-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const data = (await res.json()) as DuplicateResponse
      if (!res.ok) {
        setStatus('error')
        setError(data.error ?? `Request failed (${res.status})`)
        return
      }
      setStatus('success')
      setResult(data)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Network error')
    }
  }

  const isSubmitting = status === 'submitting'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 500,
          border: '1px solid var(--theme-elevation-200)',
          borderRadius: 4,
          backgroundColor: 'var(--theme-elevation-0)',
          color: 'var(--theme-elevation-1000)',
          cursor: 'pointer',
        }}
        title="Duplicate this course and all of its chapters, lessons, exercises, and sections"
      >
        Duplicate
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={DIALOG_TITLE_ID}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--theme-elevation-0)',
              border: '1px solid var(--theme-elevation-200)',
              borderRadius: 6,
              padding: 24,
              width: 480,
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflowY: 'auto',
              color: 'var(--theme-elevation-1000)',
            }}
          >
            <h3 id={DIALOG_TITLE_ID} style={{ marginTop: 0 }}>
              Duplicate course
            </h3>
            <p style={{ fontSize: 13, color: 'var(--theme-elevation-600)' }}>
              Creates an exact copy of this course and every chapter, lesson, exercise, and section
              inside it. The copy is created as a draft — nothing goes live until you publish it.
            </p>
            <p style={{ fontSize: 13, color: 'var(--theme-elevation-600)' }}>
              This can take a while for large courses. Please don&apos;t close the modal until it
              finishes.
            </p>

            {status === 'error' && error && (
              <div style={{ color: 'var(--theme-error-500)', fontSize: 13, marginTop: 12 }}>
                {error}
              </div>
            )}
            {status === 'success' && result?.outputCourseId && (
              <div style={{ fontSize: 13, marginTop: 12 }}>
                <div style={{ color: 'var(--theme-success-500)', marginBottom: 8 }}>
                  Course duplicated.
                </div>
                {result.counts && (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>
                      Chapters: {result.counts.chaptersCloned}
                      {result.counts.chaptersFailed > 0
                        ? ` (${result.counts.chaptersFailed} failed)`
                        : ''}
                    </li>
                    <li>
                      Lessons: {result.counts.lessonsCloned}
                      {result.counts.lessonsFailed > 0
                        ? ` (${result.counts.lessonsFailed} failed)`
                        : ''}
                    </li>
                    <li>
                      Exercises: {result.counts.exercisesCloned}
                      {result.counts.exercisesFailed > 0
                        ? ` (${result.counts.exercisesFailed} failed)`
                        : ''}
                    </li>
                    <li>
                      Sections: {result.counts.sectionsCloned}
                      {result.counts.sectionsFailed > 0
                        ? ` (${result.counts.sectionsFailed} failed)`
                        : ''}
                    </li>
                  </ul>
                )}
                <div style={{ marginTop: 12 }}>
                  <a
                    href={`/admin/collections/courses/${result.outputCourseId}`}
                    style={{ color: 'var(--theme-success-500)' }}
                  >
                    Open the new course →
                  </a>
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 20,
              }}
            >
              <button type="button" onClick={close} disabled={isSubmitting}>
                {status === 'success' ? 'Close' : 'Cancel'}
              </button>
              {status !== 'success' && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={isSubmitting}
                  style={{
                    backgroundColor: 'var(--theme-success-500)',
                    color: 'var(--theme-base-0)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 14px',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.6 : 1,
                  }}
                >
                  {isSubmitting ? 'Duplicating…' : 'Duplicate'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
