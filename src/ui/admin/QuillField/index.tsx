'use client'

/**
 * @fileType component
 * @ai-summary Raw HTML editor — admin-only content creation.
 *
 * SECURITY NOTE: This component is admin-only — only authorized content creators
 * (teachers) have access to it. The HTML is stored verbatim so admins can use any
 * tags/attributes/inline styles. Content shown to students goes through separate
 * rendering logic with proper sanitization.
 *
 * Used as a Field component override for:
 *   - HtmlBlock (HtmlBlock/config.ts) — `code` type with html validation
 *   - Description fields on Courses / Chapters / Lessons (`textarea` type)
 *
 * Renders a textarea with an Edit/Preview toggle. The preview mirrors the
 * front-end HtmlBlock renderer so authors see what students will see before
 * saving. Admin-only paths still render raw HTML verbatim inside a sandboxed
 * iframe or via dangerouslySetInnerHTML — student-facing rendering is
 * sanitized elsewhere.
 */

import { useField } from '@payloadcms/ui'
import { HtmlPreview } from '@/ui/admin/HtmlPreview'
import React, { useState } from 'react'

type Mode = 'edit' | 'preview'

export const QuillField: React.FC<{ path: string }> = ({ path }) => {
  const { value, setValue } = useField<string>({ path })
  const [mode, setMode] = useState<Mode>('edit')

  const handleSourceChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
  }

  const stringValue = typeof value === 'string' ? value : ''

  return (
    <div className="html-block-editor">
      <div className="html-block-editor-header">
        <span className="html-block-editor-label">HTML</span>
        <div className="html-block-editor-actions">
          <button
            type="button"
            className={`html-editor-source-toggle ${mode === 'edit' ? 'html-editor-source-toggle--active' : ''}`}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className={`html-editor-source-toggle ${mode === 'preview' ? 'html-editor-source-toggle--active' : ''}`}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <textarea
          className="html-block-source-textarea"
          value={stringValue}
          onChange={handleSourceChange}
          placeholder="Enter HTML here. Inline styles and <style> tags are allowed."
          rows={12}
        />
      ) : (
        <HtmlPreview html={stringValue} />
      )}
    </div>
  )
}
