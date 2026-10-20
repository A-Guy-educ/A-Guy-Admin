'use client'

import { Copy, Check, ClipboardPaste, X } from 'lucide-react'
import React, { useCallback, useState } from 'react'

export type SpecKind = 'euclidean' | 'cartesian'

interface SpecImportExportBarProps<T> {
  spec: T
  kind: SpecKind
  label: string
  onImport: (next: T) => void
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function SpecImportExportBar<T>({
  spec,
  kind,
  label,
  onImport,
}: SpecImportExportBarProps<T>) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCopy = useCallback(async () => {
    const json = JSON.stringify(spec, null, 2)
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback: select hidden textarea so the user can still copy manually.
      const ta = document.createElement('textarea')
      ta.value = json
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      } finally {
        document.body.removeChild(ta)
      }
    }
  }, [spec])

  const handleApply = useCallback(() => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setError('Not valid JSON.')
      return
    }
    if (!isObject(parsed) || parsed.kind !== kind) {
      setError(`Expected a ${label} spec with "kind": "${kind}".`)
      return
    }
    onImport(parsed as T)
    setOpen(false)
    setText('')
    setError(null)
  }, [text, kind, label, onImport])

  const handleCancel = useCallback(() => {
    setOpen(false)
    setText('')
    setError(null)
  }, [])

  return (
    <div className="spec-io-bar">
      <button
        type="button"
        className="spec-io-btn"
        onClick={handleCopy}
        title={`Copy ${label} JSON to clipboard`}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <span>{copied ? 'Copied' : 'Copy JSON'}</span>
      </button>
      <button
        type="button"
        className="spec-io-btn"
        onClick={() => setOpen(true)}
        title={`Paste ${label} JSON to replace the current sketch`}
      >
        <ClipboardPaste size={14} />
        <span>Import JSON</span>
      </button>

      {open && (
        <div className="spec-io-modal-backdrop" onClick={handleCancel} role="presentation">
          <div
            className="spec-io-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Import ${label} JSON`}
          >
            <div className="spec-io-modal-header">
              <span>Import {label} JSON</span>
              <button
                type="button"
                className="spec-io-icon-btn"
                onClick={handleCancel}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <textarea
              className="spec-io-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Paste a ${label} spec JSON here. It will replace the current sketch.`}
              spellCheck={false}
              autoFocus
            />
            {error && <div className="spec-io-error">{error}</div>}
            <div className="spec-io-modal-actions">
              <button type="button" className="spec-io-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="spec-io-btn spec-io-btn--primary"
                onClick={handleApply}
                disabled={!text.trim()}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
