'use client'

import React, { useMemo, useRef } from 'react'
import type { SvgAttachmentContent } from '@/server/payload/collections/Exercises/types'
import { sanitizeSvg } from '@/ui/admin/shared/utils'
import { InlineRichTextEditor } from './InlineRichTextEditor'

export function validateSvg(value: string): { valid: boolean; error?: string } {
  if (!value.trim()) return { valid: false, error: 'SVG content is empty' }
  if (!value.includes('<svg')) return { valid: false, error: 'Missing <svg> element' }
  if (!value.includes('</svg>') && !value.includes('/>')) {
    return { valid: false, error: 'SVG element is not closed' }
  }
  if (typeof DOMParser === 'undefined') return { valid: true }
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(value, 'image/svg+xml')
    const errorNode = doc.querySelector('parsererror')
    if (errorNode) {
      return {
        valid: false,
        error: 'Malformed XML: ' + (errorNode.textContent?.slice(0, 80) ?? ''),
      }
    }
    if (!doc.querySelector('svg')) return { valid: false, error: 'No root <svg> element found' }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Failed to parse SVG' }
  }
}

interface SvgContentEditorProps {
  content: SvgAttachmentContent
  onChange: (content: SvgAttachmentContent) => void
  /** Show caption editor (used by attachment; standalone svg block hides it). */
  showCaption?: boolean
}

/**
 * Raw SVG markup + upload + preview + alt text (and optionally caption).
 * Shared by the standalone `svg` block editor and the `attachment.svg` field
 * so both surfaces get the same validation and preview UI.
 */
export const SvgContentEditor: React.FC<SvgContentEditorProps> = ({
  content,
  onChange,
  showCaption = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validation = useMemo(() => validateSvg(content.value), [content.value])
  const sanitized = useMemo(() => {
    if (!validation.valid) return null
    return sanitizeSvg(content.value)
  }, [content.value, validation.valid])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.name.endsWith('.svg')) return
    const reader = new FileReader()
    reader.onload = () => {
      const raw = reader.result as string
      const { sanitized: cleaned } = sanitizeSvg(raw)
      onChange({ ...content, value: cleaned || raw })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
      <div className="question-editor-section">
        <label className="question-editor-label">SVG Code</label>
        <div className="svg-editor-toolbar">
          <button
            type="button"
            className="svg-editor-upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload .svg
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".svg"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <span
            className={`svg-editor-status ${
              validation.valid ? 'svg-editor-status--valid' : 'svg-editor-status--invalid'
            }`}
          >
            {validation.valid ? 'Valid' : validation.error}
          </span>
        </div>
        <textarea
          className="svg-editor-textarea"
          value={content.value}
          onChange={(e) => onChange({ ...content, value: e.target.value })}
          spellCheck={false}
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Preview</label>
        <div className="svg-editor-preview">
          {validation.valid && sanitized ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URI, next/image can't optimize
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized.sanitized)}`}
              alt={content.altText || 'SVG Preview'}
              className="svg-editor-preview-img"
            />
          ) : (
            <div className="svg-editor-preview-error">
              {validation.error || 'No valid SVG to preview'}
            </div>
          )}
        </div>
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Alt Text</label>
        <input
          type="text"
          className="svg-editor-alt-input"
          value={content.altText || ''}
          onChange={(e) => onChange({ ...content, altText: e.target.value })}
          placeholder="Describe this image for accessibility..."
        />
      </div>

      {showCaption && (
        <div className="question-editor-section">
          <label className="question-editor-label">Caption (optional)</label>
          <InlineRichTextEditor
            value={
              content.caption ?? {
                type: 'rich_text',
                format: 'md-math-v1',
                value: '',
                mediaIds: [],
              }
            }
            onChange={(caption) => {
              const hasContent = caption.value.trim().length > 0 || caption.mediaIds.length > 0
              onChange({ ...content, caption: hasContent ? caption : undefined })
            }}
            placeholder="Optional caption shown below the sketch"
          />
        </div>
      )}
    </>
  )
}
