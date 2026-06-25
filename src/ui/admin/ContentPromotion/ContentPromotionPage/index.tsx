'use client'

import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'

import {
  cardStyle,
  errorBannerStyle,
  sectionHeadingStyle,
  successBannerStyle,
} from '@/ui/admin/PdfConversion/styles'

const PROMOTED_COLLECTIONS = ['media', 'courses', 'chapters', 'lessons', 'exercises'] as const
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

  const runExport = useCallback(async () => {
    setExporting(true)
    setExportError(null)
    setExportInfo(null)
    try {
      const response = await fetch('/api/content-promotion/export', {
        method: 'GET',
        credentials: 'include',
      })
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
  }, [])

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
          Bundles all <code>media</code>, <code>courses</code>, <code>chapters</code>,{' '}
          <code>lessons</code>, and <code>exercises</code> records — including media binaries — into
          a single zip you can import into another environment. Run this on the{' '}
          <strong>source</strong> environment (typically dev).
        </p>
        {exportError && <div style={errorBannerStyle}>{exportError}</div>}
        {exportInfo && <div style={successBannerStyle}>{exportInfo}</div>}
        <button
          style={exporting ? disabledButtonStyle : secondaryButtonStyle}
          disabled={exporting}
          onClick={runExport}
        >
          {exporting ? 'Building bundle…' : 'Download bundle'}
        </button>
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
