'use client'

/**
 * LessonExportButton — admin "Export as Text" / "Export as JSON" actions on
 * the lesson edit view.
 *
 * Fetches /api/lessons/:id/export and triggers a browser file download. Text
 * is the v2 format accepted by /admin/lesson-json-import; JSON is the lossless
 * full-lesson export meant for editing with an LLM and importing back.
 *
 * @fileType component
 * @domain lessons
 * @pattern admin-action-button
 * @ai-summary Exports a lesson and its exercises as a plain-text file for backup, review, or re-import.
 */
import React, { useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

type ExportFormat = 'text' | 'json'

const BUTTONS: Array<{ format: ExportFormat; label: string; title: string }> = [
  {
    format: 'text',
    label: 'Export as Text',
    title: 'Export lesson and exercises as plain text (.txt)',
  },
  {
    format: 'json',
    label: 'Export as JSON',
    title: 'Lossless export of every block (.json) — edit with ChatGPT/Gemini and import back',
  },
]

export const LessonExportAction: React.FC = () => {
  const { id } = useDocumentInfo()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!id) return null

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true)
    setError(null)

    try {
      const query = format === 'json' ? '?format=json' : ''
      const res = await fetch(`/api/lessons/${id}/export${query}`, {
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Export failed (${res.status})`)
        return
      }

      // Extract filename from Content-Disposition header
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?([^"\n]+)"?/)
      const filename = match?.[1] || `${id}.${format === 'json' ? 'json' : 'txt'}`

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      {BUTTONS.map((b) => (
        <button
          key={b.format}
          type="button"
          onClick={() => handleExport(b.format)}
          disabled={isExporting}
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
            cursor: isExporting ? 'not-allowed' : 'pointer',
            opacity: isExporting ? 0.6 : 1,
          }}
          title={b.title}
        >
          {isExporting ? 'Exporting…' : b.label}
        </button>
      ))}

      {error && (
        <span
          style={{
            color: 'var(--theme-error-500)',
            fontSize: 12,
            marginLeft: 8,
          }}
        >
          {error}
        </span>
      )}
    </>
  )
}
