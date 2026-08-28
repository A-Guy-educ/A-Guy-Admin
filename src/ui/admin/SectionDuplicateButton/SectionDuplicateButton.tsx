'use client'

/**
 * SectionDuplicateButton — admin "Duplicate" action on the section edit view.
 *
 * @fileType component
 * @domain sections
 * @pattern admin-action-modal
 * @ai-summary Opens a confirmation modal, then POSTs to /api/studio/sections/:id/duplicate.
 *
 * Replaces Payload's built-in per-collection duplicate button (which is
 * disabled on the Sections collection via `disableDuplicate: true`). The
 * built-in was a shallow field copy that copied `content.blocks` verbatim
 * — every nested block id was reused, so any edit to a block on the
 * "duplicated" section overwrote the same id on the source. This action
 * calls `/api/studio/sections/:id/duplicate`, which strips managed fields,
 * regenerates every block id inside `content.blocks`, and positions the
 * copy right after the source in the parent exercise's playlist.
 *
 * Access: same role gate as the endpoint (admin OR advanced content
 * editor). Hidden for non-privileged users to avoid the confusing
 * click-then-403 UX called out in `CascadeDeleteButton`.
 */
import React, { useEffect, useState } from 'react'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'

type Status = 'idle' | 'submitting' | 'success' | 'error'

interface DuplicateResponse {
  id?: string
  error?: string
}

const DIALOG_TITLE_ID = 'section-duplicate-modal-title'

export const SectionDuplicateAction: React.FC = () => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DuplicateResponse | null>(null)

  // Escape-to-close while the modal is open — but only when a request
  // isn't in flight. Closing mid-submit would drop the success link to the
  // new section, and the server-side clone can't be cancelled anyway.
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
  // Mirror the endpoint's role gate (admin OR advanced content editor) so
  // ACEs still see the button they can use, but Student/unauthenticated
  // never get the click-then-403 UX.
  const role = user && 'role' in user ? (user as { role?: unknown }).role : null
  const allowed =
    role === AccountRole.Admin ||
    (typeof role === 'string' && isAdvancedContentEditor(role as AccountRole))
  if (!allowed) return null

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
      const res = await fetch(`/api/studio/sections/${id}/duplicate`, {
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
        className="rounded border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-0)] px-3 py-1.5 text-[13px] font-medium text-[var(--theme-elevation-1000)] cursor-pointer"
        title="Duplicate this section (positions the copy right after the source in the exercise playlist)"
      >
        Duplicate
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={DIALOG_TITLE_ID}
          onClick={close}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[90vw] max-w-[440px] max-h-[85vh] overflow-y-auto rounded-md border border-[var(--theme-elevation-200)] bg-[var(--theme-elevation-0)] p-6 text-[var(--theme-elevation-1000)]"
          >
            <h3 id={DIALOG_TITLE_ID} className="mt-0 mb-3 text-body-md font-semibold">
              Duplicate section
            </h3>
            <p className="text-body-sm text-[var(--theme-elevation-600)]">
              Creates an exact copy of this section under the same exercise. The copy is placed
              right after the source in the exercise&apos;s section playlist.
            </p>

            {status === 'error' && error && (
              <div className="mt-3 text-[13px] text-[var(--theme-error-500)]">{error}</div>
            )}
            {status === 'success' && result?.id && (
              <div className="mt-3 text-[13px]">
                <div className="mb-2 text-[var(--theme-success-500)]">Section duplicated.</div>
                <div className="mt-3">
                  <a
                    href={`/admin/collections/sections/${result.id}`}
                    className="text-[var(--theme-success-500)]"
                  >
                    Open the new section →
                  </a>
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={isSubmitting}
                className="cursor-pointer rounded border border-[var(--theme-elevation-300)] bg-transparent px-4 py-1.5 text-[13px] font-medium text-[var(--theme-elevation-800)] disabled:cursor-not-allowed"
              >
                {status === 'success' ? 'Close' : 'Cancel'}
              </button>
              {status !== 'success' && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={isSubmitting}
                  className="cursor-pointer rounded border-none bg-[var(--theme-success-500)] px-4 py-1.5 text-[13px] font-semibold text-[var(--theme-base-0)] disabled:cursor-not-allowed disabled:opacity-60"
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
