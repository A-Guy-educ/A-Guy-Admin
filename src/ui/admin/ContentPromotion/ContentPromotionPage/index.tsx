'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cardStyle,
  errorBannerStyle,
  sectionHeadingStyle,
  successBannerStyle,
} from '@/ui/admin/PdfConversion/styles'

// Kept in sync with `@/server/services/content-promotion/constants`. Not
// imported from there directly because that module lives under `@/server`
// and importing into a `'use client'` file drags server-only types into
// the client bundle. If you add a promoted collection on the server side,
// add it here too — otherwise the import-results table below silently
// drops that collection's per-collection stats.
const PROMOTED_COLLECTIONS = [
  'media',
  'courses',
  'chapters',
  'lessons',
  'exercises',
  'sections',
] as const
type PromotedCollection = (typeof PROMOTED_COLLECTIONS)[number]

interface ImportReport {
  perCollection: Record<
    PromotedCollection,
    {
      created: number
      remapped: number
      failed: number
      failures: Array<{ id: string; message: string }>
    }
  >
  remappedIds: Record<string, string>
  blobsUploaded: number
  durationMs: number
}

interface CourseOption {
  id: string
  title: string
  courseLabel?: string
  locale?: string
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

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--theme-elevation-0)',
  backgroundColor: 'var(--theme-success)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: 'var(--theme-info)',
}

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: 'var(--theme-elevation-200)',
  color: 'var(--theme-elevation-500)',
  cursor: 'not-allowed',
}

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12,
  color: 'var(--theme-info)',
  cursor: 'pointer',
  textDecoration: 'underline',
}

const helpStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--theme-elevation-500)',
  marginTop: 8,
  lineHeight: 1.5,
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  marginTop: 16,
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

const courseListStyle: React.CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  border: '1px solid var(--theme-elevation-200)',
  borderRadius: 4,
  marginTop: 8,
}

const courseRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderBottom: '1px solid var(--theme-elevation-150)',
  fontSize: 13,
  color: 'var(--theme-elevation-1000)',
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  marginTop: 12,
  fontSize: 12,
  color: 'var(--theme-elevation-600)',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ContentPromotionPage() {
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exportInfo, setExportInfo] = useState<string | null>(null)
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const importFileRef = useRef<HTMLInputElement | null>(null)

  const [courses, setCourses] = useState<CourseOption[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const controller = new AbortController()
    async function fetchCourses() {
      setCoursesLoading(true)
      setCoursesError(null)
      try {
        // depth: 0 keeps the payload small — we only need id/title/label/locale.
        // limit: 0 means "no pagination cap"; Payload returns all docs in one shot.
        const res = await fetch(
          `/api/courses?limit=0&depth=0&sort=courseLabel&select[id]=true&select[title]=true&select[courseLabel]=true&select[locale]=true`,
          { credentials: 'include', signal: controller.signal },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const docs: CourseOption[] = (data.docs || []).map((d: CourseOption) => ({
          id: d.id,
          title: d.title || '(untitled)',
          courseLabel: d.courseLabel,
          locale: d.locale,
        }))
        setCourses(docs)
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        setCoursesError(err instanceof Error ? err.message : 'Failed to load courses')
      } finally {
        setCoursesLoading(false)
      }
    }
    void fetchCourses()
    return () => controller.abort()
  }, [])

  const toggleCourse = useCallback((id: string) => {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedCourseIds(new Set(courses.map((c) => c.id)))
  }, [courses])

  const clearAll = useCallback(() => {
    setSelectedCourseIds(new Set())
  }, [])

  const canExport = useMemo(
    () => selectedCourseIds.size > 0 && !exporting,
    [selectedCourseIds, exporting],
  )

  const runExport = useCallback(async () => {
    if (selectedCourseIds.size === 0) return
    setExporting(true)
    setExportError(null)
    setExportInfo(null)
    try {
      const ids = Array.from(selectedCourseIds).join(',')
      const response = await fetch(
        `/api/content-promotion/export?courseIds=${encodeURIComponent(ids)}`,
        { method: 'GET', credentials: 'include' },
      )
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `HTTP ${response.status}`)
      }
      const reportHeader = response.headers.get('X-Content-Promotion-Report')
      const blob = await response.blob()
      const filenameMatch = /filename="([^"]+)"/.exec(
        response.headers.get('Content-Disposition') || '',
      )
      const filename = filenameMatch?.[1] || `content-bundle-${Date.now()}.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (reportHeader) {
        try {
          const report = JSON.parse(reportHeader)
          setExportInfo(
            `Exported ${Object.values(report.counts).reduce((a: number, n) => a + (n as number), 0)} records and ${report.blobs} media blobs (${formatBytes(report.bytes)}) in ${report.durationMs}ms.`,
          )
        } catch {
          setExportInfo('Bundle downloaded.')
        }
      } else {
        setExportInfo('Bundle downloaded.')
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [selectedCourseIds])

  const onPickBundle = useCallback(() => {
    importFileRef.current?.click()
  }, [])

  const runImport = useCallback(async (file: File) => {
    setImporting(true)
    setImportError(null)
    setImportReport(null)
    try {
      const formData = new FormData()
      formData.append('bundle', file)
      const response = await fetch('/api/content-promotion/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const envelope = await response.json()
      if (!response.ok || envelope.error) {
        throw new Error(envelope.error?.message || `HTTP ${response.status}`)
      }
      setImportReport(envelope.data as ImportReport)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [])

  const confirmed = confirmText.trim().toUpperCase() === 'IMPORT'

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
        <h1 style={titleStyle}>Content Promotion</h1>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h2 style={sectionHeadingStyle}>Export bundle</h2>
        <p style={helpStyle}>
          Pick one or more courses to bundle. The export walks each course&apos;s chapters, lessons,
          and exercises and includes every referenced media binary. Re-importing into the same
          environment never overwrites existing docs (safe-clone), so selecting only courses you
          actually changed avoids creating duplicates of unchanged content on the target.
        </p>

        {coursesError && <div style={errorBannerStyle}>Courses: {coursesError}</div>}

        {coursesLoading ? (
          <div style={{ ...helpStyle, marginTop: 12 }}>Loading courses…</div>
        ) : courses.length === 0 ? (
          <div style={{ ...helpStyle, marginTop: 12 }}>No courses found.</div>
        ) : (
          <>
            <div style={courseListStyle}>
              {courses.map((c) => {
                const checked = selectedCourseIds.has(c.id)
                return (
                  <label key={c.id} style={{ ...courseRowStyle, cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCourse(c.id)} />
                    <span style={{ fontWeight: 500, minWidth: 80 }}>{c.courseLabel || '—'}</span>
                    <span style={{ flex: 1 }}>{c.title}</span>
                    {c.locale && (
                      <span style={{ color: 'var(--theme-elevation-500)', fontSize: 11 }}>
                        {c.locale}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            <div style={toolbarStyle}>
              <span>
                {selectedCourseIds.size} of {courses.length} selected
              </span>
              <button type="button" style={linkButtonStyle} onClick={selectAll}>
                Select all
              </button>
              <button type="button" style={linkButtonStyle} onClick={clearAll}>
                Clear
              </button>
            </div>
          </>
        )}

        {exportError && <div style={{ ...errorBannerStyle, marginTop: 12 }}>{exportError}</div>}
        {exportInfo && <div style={{ ...successBannerStyle, marginTop: 12 }}>{exportInfo}</div>}

        <div style={{ marginTop: 16 }}>
          <button
            style={canExport ? secondaryButtonStyle : disabledButtonStyle}
            disabled={!canExport}
            onClick={runExport}
          >
            {exporting
              ? 'Building bundle…'
              : `Download bundle (${selectedCourseIds.size} course${selectedCourseIds.size === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h2 style={sectionHeadingStyle}>Import bundle</h2>
        <p style={helpStyle}>
          Upload a zip produced by the export above. The import runs in <strong>safe-clone</strong>{' '}
          mode: existing IDs are preserved when free on this environment, and freshly generated when
          they collide — nothing already in this database is ever overwritten. The whole import runs
          in a single Payload transaction, so any per-doc failure rolls everything back. Run this on
          the <strong>target</strong> environment (typically production).
        </p>
        <p style={helpStyle}>
          Type <code>IMPORT</code> below to enable the upload button.
        </p>
        <input
          type="text"
          placeholder="Type IMPORT to confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          style={{
            height: 36,
            padding: '0 10px',
            fontSize: 13,
            border: '1px solid var(--theme-elevation-200)',
            borderRadius: 4,
            backgroundColor: 'var(--theme-elevation-0)',
            color: 'var(--theme-elevation-1000)',
            marginRight: 12,
            width: 240,
          }}
        />
        <button
          style={!confirmed || importing ? disabledButtonStyle : primaryButtonStyle}
          disabled={!confirmed || importing}
          onClick={onPickBundle}
        >
          {importing ? 'Importing…' : 'Choose bundle and import'}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void runImport(file)
            e.target.value = ''
          }}
        />

        {importError && <div style={{ ...errorBannerStyle, marginTop: 12 }}>{importError}</div>}

        {importReport && (
          <div style={{ marginTop: 16 }}>
            <div style={successBannerStyle}>
              Imported in {importReport.durationMs}ms. {importReport.blobsUploaded} media binaries
              uploaded. {Object.keys(importReport.remappedIds).length} IDs remapped due to
              collisions.
            </div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Collection</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Remapped (collision)</th>
                  <th style={thStyle}>Failed</th>
                </tr>
              </thead>
              <tbody>
                {PROMOTED_COLLECTIONS.map((collection) => {
                  const stats = importReport.perCollection[collection]
                  return (
                    <tr key={collection}>
                      <td style={tdStyle}>{collection}</td>
                      <td style={tdStyle}>{stats.created}</td>
                      <td style={tdStyle}>{stats.remapped}</td>
                      <td style={tdStyle}>{stats.failed}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
