'use client'

import React from 'react'
import type {
  QuestionGeometryBlock,
  GraphLayout,
} from '@/server/payload/collections/Exercises/types'
import { GeometrySpecEditor } from './GeometrySpecEditor'
import { InlineRichTextEditor } from './InlineRichTextEditor'

interface GeometryEditorProps {
  block: QuestionGeometryBlock
  onChange: (block: QuestionGeometryBlock) => void
}

export const GeometryEditor: React.FC<GeometryEditorProps> = ({ block, onChange }) => {
  return (
    <div className="geometry-editor">
      <div className="question-editor-section">
        <div className="canvas-config-row">
          <div className="panel-field">
            <span className="panel-field-label">Display Size</span>
            <select
              className="panel-field-select"
              value={block.displaySize || 'full'}
              onChange={(e) =>
                onChange({
                  ...block,
                  displaySize: e.target.value as 'xsmall' | 'small' | 'medium' | 'large' | 'full',
                })
              }
            >
              <option value="xsmall">25%</option>
              <option value="small">33%</option>
              <option value="medium">50%</option>
              <option value="large">75%</option>
              <option value="full">100%</option>
            </select>
          </div>
        </div>
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Prompt</label>
        <InlineRichTextEditor
          value={block.prompt}
          onChange={(prompt) => onChange({ ...block, prompt })}
          placeholder="Enter your geometry question..."
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Layout</label>
        <select
          className="w-full p-2 border border-input rounded-md bg-background text-foreground"
          value={block.layout || 'textRight'}
          onChange={(e) => onChange({ ...block, layout: e.target.value as GraphLayout })}
        >
          <option value="textAbove">Text Above, Graph Below</option>
          <option value="textBelow">Text Below, Graph Above</option>
          <option value="textLeft">Text Left, Graph Right</option>
          <option value="textRight">Text Right, Graph Left</option>
        </select>
      </div>

      <div className="question-editor-section">
        <GeometrySpecEditor
          canvasId={`geo-canvas-${block.id}`}
          spec={block.geometry}
          onChange={(geometry) => onChange({ ...block, geometry })}
        />
      </div>
    </div>
  )
}
