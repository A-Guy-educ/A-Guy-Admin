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
 * and every nested chapter / lesson / exercise. The modal exists so admins
 * confirm intent (this can create hundreds of rows) and can see the resulting
 * counts once the clone finishes.
 */
import React, { useState } from 'react'
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
  }
  error?: string
}

export const CourseDuplicateAction: React.FC = () => {
  const { id } = useDocumentInfo()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DuplicateResponse | null>(null)

  if (!id) return null

  const reset = () => {
    setStatus('idle')
    setError(null)
    setResult(null)
  }

  const close = () => {
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
        title="Duplicate this course and all of its chapters, lessons, and exercises"
      >
        Duplicate
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
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
            <h3 style={{ marginTop: 0 }}>Duplicate course</h3>
            <p style={{ fontSize: 13, color: 'var(--theme-elevation-600)' }}>
              Creates an exact copy of this course and every chapter, lesson, and exercise inside
              it. The copy is created as a draft — nothing goes live until you publish it.
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
              <button type="button" onClick={close}>
                {status === 'success' ? 'Close' : 'Cancel'}
              </button>
              {status !== 'success' && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={status === 'submitting'}
                  style={{
                    backgroundColor: 'var(--theme-success-500)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 14px',
                    cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
                    opacity: status === 'submitting' ? 0.6 : 1,
                  }}
                >
                  {status === 'submitting' ? 'Duplicating…' : 'Duplicate'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
