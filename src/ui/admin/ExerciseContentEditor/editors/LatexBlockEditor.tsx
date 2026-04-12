'use client'

import type { LatexBlock } from '@/server/payload/collections/Exercises/types'
import { MathMarkdown } from '@/ui/web/shared/MathMarkdown'
import React, { useState } from 'react'

interface LatexBlockEditorProps {
  block: LatexBlock
  onChange: (block: LatexBlock) => void
}

export const LatexBlockEditor: React.FC<LatexBlockEditorProps> = ({ block, onChange }) => {
  const [showPreview, setShowPreview] = useState(false)

  const handleLatexChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...block, latex: e.target.value })
  }

  const handleRenderModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...block, renderMode: e.target.value as 'block' | 'inline' })
  }

  const renderMode = block.renderMode ?? 'block'
  const wrappedLatex = renderMode === 'inline' ? `$${block.latex}$` : `$$\n${block.latex}\n$$`

  return (
    <div className="latex-block-editor">
      <div className="latex-block-editor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>Render Mode:</label>
          <select
            value={renderMode}
            onChange={handleRenderModeChange}
            style={{ fontSize: '13px', padding: '2px 6px' }}
          >
            <option value="block">Block (display math)</option>
            <option value="inline">Inline</option>
          </select>
        </div>
        <button
          type="button"
          className={`html-editor-source-toggle ${showPreview ? 'html-editor-source-toggle--active' : ''}`}
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {showPreview ? (
        <div
          style={{
            padding: '16px',
            border: '1px solid var(--theme-elevation-150)',
            borderRadius: '4px',
            minHeight: '80px',
            background: 'var(--theme-elevation-50)',
          }}
        >
          {block.latex ? (
            <MathMarkdown content={wrappedLatex} />
          ) : (
            <p style={{ color: 'var(--theme-elevation-400)', fontStyle: 'italic' }}>
              No LaTeX content to preview
            </p>
          )}
        </div>
      ) : (
        <textarea
          className="html-block-source-textarea"
          value={block.latex}
          onChange={handleLatexChange}
          placeholder="Enter LaTeX code here, e.g. \frac{a}{b} or \int_0^1 f(x)\,dx"
          rows={8}
          style={{ fontFamily: 'monospace' }}
        />
      )}
    </div>
  )
}
