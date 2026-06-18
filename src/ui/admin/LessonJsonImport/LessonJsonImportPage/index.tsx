'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

import {
  cardStyle,
  errorBannerStyle,
  sectionHeadingStyle,
  successBannerStyle,
} from '@/ui/admin/PdfConversion/styles'

import { ChapterSelector } from '../ChapterSelector'

type ParseStatus = 'valid' | 'invalid'

interface FileEntry {
  id: string
  filename: string
  json: unknown
  status: ParseStatus
  parseError?: string
  lessonTopic?: string
  exerciseCount?: number
}

interface FileResult {
  filename: string
  state: 'pending' | 'running' | 'done' | 'failed'
  message?: string
  lessonId?: string
  exercisesCreated?: number
  exercisesFailed?: number
}

const pageStyle: React.CSSProperties = {
  padding: 'calc(var(--base) * 1.5)',
  maxWidth: 1200,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(var(--base) * 0.75)',
  marginBottom: 'calc(var(--base) * 1.25)',
  paddingBottom: 'calc(var(--base) * 1.25)',
  borderBottom: '1px solid var(--theme-elevation-150)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--theme-text)',
  margin: 0,
}

const dropzoneStyle: React.CSSProperties = {
  border: '2px dashed var(--theme-elevation-300)',
  borderRadius: 6,
  padding: 24,
  textAlign: 'center',
  fontSize: 13,
  color: 'var(--theme-elevation-600)',
  cursor: 'pointer',
  backgroundColor: 'var(--theme-elevation-0)',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--theme-elevation-200)',
  color: 'var(--theme-elevation-700)',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--theme-elevation-150)',
  color: 'var(--theme-elevation-1000)',
  verticalAlign: 'top',
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--theme-elevation-0)',
  backgroundColor: 'var(--theme-success)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
}

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: 'var(--theme-elevation-200)',
  color: 'var(--theme-elevation-500)',
  cursor: 'not-allowed',
}

const statusColors: Record<FileResult['state'], string> = {
  pending: 'var(--theme-elevation-500)',
  running: 'var(--theme-info)',
  done: 'var(--theme-success)',
  failed: 'var(--theme-error)',
}

function safeParseLesson(json: unknown): {
  topic?: string
  exerciseCount?: number
  error?: string
} {
  if (typeof json !== 'object' || json === null) return { error: 'JSON root is not an object' }
  const obj = json as { topic?: unknown; exercises?: unknown }
  const topic = typeof obj.topic === 'string' ? obj.topic : undefined
  const exercises = Array.isArray(obj.exercises) ? obj.exercises : null
  if (!topic) return { error: 'Missing "topic" field' }
  if (!exercises || exercises.length === 0) return { error: 'Missing or empty "exercises" array' }
  return { topic, exerciseCount: exercises.length }
}

export function LessonJsonImportPage() {
  const [chapterId, setChapterId] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [results, setResults] = useState<Record<string, FileResult>>({})
  const [isImporting, setIsImporting] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const onFiles = useCallback(async (selected: FileList | null) => {
    if (!selected) return
    setGlobalError(null)
    const next: FileEntry[] = []
    for (const file of Array.from(selected)) {
      if (!file.name.toLowerCase().endsWith('.json')) continue
      try {
        const text = await file.text()
        const json = JSON.parse(text)
        const summary = safeParseLesson(json)
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          filename: file.name,
          json,
          status: summary.error ? 'invalid' : 'valid',
          parseError: summary.error,
          lessonTopic: summary.topic,
          exerciseCount: summary.exerciseCount,
        })
      } catch (err) {
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          filename: file.name,
          json: null,
          status: 'invalid',
          parseError: err instanceof Error ? err.message : 'Invalid JSON',
        })
      }
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.id))
      const merged = [...prev]
      for (const f of next) if (!seen.has(f.id)) merged.push(f)
      return merged
    })
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      onFiles(e.dataTransfer.files)
    },
    [onFiles],
  )

  const validFiles = files.filter((f) => f.status === 'valid')
  const canImport = chapterId !== null && validFiles.length > 0 && !isImporting

  const runImport = useCallback(async () => {
    if (!chapterId) return
    setIsImporting(true)
    setGlobalError(null)
    const queue = validFiles
    const next: Record<string, FileResult> = {}
    for (const f of queue) next[f.id] = { filename: f.filename, state: 'pending' }
    setResults(next)

    for (const f of queue) {
      setResults((prev) => ({
        ...prev,
        [f.id]: { ...prev[f.id], state: 'running' },
      }))
      try {
        const res = await fetch('/api/lessons/import-from-json', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapterId,
            filename: f.filename,
            json: f.json,
          }),
        })
        const envelope = await res.json()
        if (!res.ok || envelope.error) {
          const message =
            envelope.error?.message ||
            (envelope.error?.details?.issues
              ? envelope.error.details.issues.join('; ')
              : `HTTP ${res.status}`)
          setResults((prev) => ({
            ...prev,
            [f.id]: { ...prev[f.id], state: 'failed', message },
          }))
          continue
        }
        const data = envelope.data || {}
        setResults((prev) => ({
          ...prev,
          [f.id]: {
            ...prev[f.id],
            state: data.exercisesFailed > 0 ? 'failed' : 'done',
            lessonId: data.lessonId,
            exercisesCreated: data.exercisesCreated,
            exercisesFailed: data.exercisesFailed,
            message:
              data.exercisesFailed > 0
                ? `Rolled back — ${data.exercisesFailed} exercise${data.exercisesFailed === 1 ? '' : 's'} failed to import`
                : `Created lesson with ${data.exercisesCreated} exercises`,
          },
        }))
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [f.id]: {
            ...prev[f.id],
            state: 'failed',
            message: err instanceof Error ? err.message : 'Network error',
          },
        }))
      }
    }
    setIsImporting(false)
  }, [chapterId, validFiles])

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <Link
          href="/admin"
          style={{ color: 'var(--theme-elevation-500)', textDecoration: 'none', fontSize: 13 }}
        >
          Dashboard
        </Link>
        <span style={{ color: 'var(--theme-elevation-300)', fontSize: 14 }}>›</span>
        <h1 style={titleStyle}>Import Lessons from JSON</h1>
      </div>

      {globalError && <div style={errorBannerStyle}>{globalError}</div>}

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h2 style={sectionHeadingStyle}>1. Pick target chapter</h2>
        <ChapterSelector
          selectedChapterId={chapterId}
          onSelectChapter={(c) => setChapterId(c.id)}
        />
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h2 style={sectionHeadingStyle}>2. Drop JSON files</h2>
        <label htmlFor="json-file-input">
          <div style={dropzoneStyle} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            Drag &amp; drop lesson JSON files here, or click to browse.
            <input
              id="json-file-input"
              type="file"
              accept=".json,application/json"
              multiple
              onChange={(e) => onFiles(e.target.files)}
              style={{ display: 'none' }}
            />
          </div>
        </label>

        {files.length > 0 && (
          <table style={{ ...tableStyle, marginTop: 16 }}>
            <thead>
              <tr>
                <th style={thStyle}>File</th>
                <th style={thStyle}>Lesson title</th>
                <th style={thStyle}>Exercises</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td style={tdStyle}>{f.filename}</td>
                  <td style={tdStyle}>{f.lessonTopic || '—'}</td>
                  <td style={tdStyle}>{f.exerciseCount ?? '—'}</td>
                  <td style={tdStyle}>
                    {f.status === 'valid' ? (
                      <span style={{ color: 'var(--theme-success)' }}>✓ ready</span>
                    ) : (
                      <span style={{ color: 'var(--theme-error)' }}>✗ {f.parseError}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h2 style={sectionHeadingStyle}>3. Import</h2>
        <button
          style={canImport ? primaryButtonStyle : disabledButtonStyle}
          disabled={!canImport}
          onClick={runImport}
        >
          {isImporting
            ? `Importing… (${
                Object.values(results).filter((r) => r.state === 'done' || r.state === 'failed')
                  .length
              }/${validFiles.length})`
            : `Import ${validFiles.length} valid file${validFiles.length === 1 ? '' : 's'}`}
        </button>

        {Object.keys(results).length > 0 && (
          <table style={{ ...tableStyle, marginTop: 16 }}>
            <thead>
              <tr>
                <th style={thStyle}>File</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Details</th>
                <th style={thStyle}>Lesson</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(results).map((r) => (
                <tr key={r.filename}>
                  <td style={tdStyle}>{r.filename}</td>
                  <td style={{ ...tdStyle, color: statusColors[r.state] }}>{r.state}</td>
                  <td style={tdStyle}>{r.message || ''}</td>
                  <td style={tdStyle}>
                    {r.lessonId ? (
                      <Link
                        href={`/admin/collections/lessons/${r.lessonId}`}
                        style={{ color: 'var(--theme-info)' }}
                      >
                        Open
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!isImporting && Object.values(results).some((r) => r.state === 'done') && (
        <div style={successBannerStyle}>
          Done. Imported lessons are saved as draft so you can review before publishing.
        </div>
      )}
    </div>
  )
}
