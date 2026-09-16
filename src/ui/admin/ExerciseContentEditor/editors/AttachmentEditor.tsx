'use client'

import React from 'react'
import type {
  GraphLayout,
  QuestionAttachment,
  SvgAttachmentContent,
} from '@/server/payload/collections/Exercises/types'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import { AxisSpecEditor } from './AxisSpecEditor'
import { GeometrySpecEditor } from './GeometrySpecEditor'
import { InlineRichTextEditor } from './InlineRichTextEditor'

type AttachmentKind = QuestionAttachment['kind']

const LAYOUT_OPTIONS: Array<{ value: GraphLayout; label: string }> = [
  { value: 'textAbove', label: 'Text Above, Graph Below' },
  { value: 'textBelow', label: 'Text Below, Graph Above' },
  { value: 'textLeft', label: 'Text Left, Graph Right' },
  { value: 'textRight', label: 'Text Right, Graph Left' },
]

const DEFAULT_LAYOUT: GraphLayout = 'textRight'

const defaultSvg = (): SvgAttachmentContent => ({
  value:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">\n  <circle cx="100" cy="100" r="50" fill="none" stroke="black" />\n</svg>',
  altText: '',
})

const defaultGeometry = (): GeometrySpecV1 => ({
  kind: 'euclidean',
  canvas: { width: 500, height: 500, background: '#ffffff', grid: true },
  elements: {
    points: [
      { name: 'A', x: 150, y: 150, position: 'tl', visible: true, color: '#1a1a2e' },
      { name: 'B', x: 350, y: 150, position: 'tr', visible: true, color: '#1a1a2e' },
      { name: 'C', x: 250, y: 350, position: 'b', visible: true, color: '#1a1a2e' },
    ],
    lines: [],
    circles: [],
    angles: [],
  },
  interactionSpec: {
    enabled: false,
    toolsAllowed: [],
    evaluation: { mode: 'none' },
  },
})

const defaultAxis = (): AxisSpecV1 => ({
  kind: 'cartesian',
  units: 1,
  grid: { enabled: true, color: '#e0e0e0' },
  axes: {
    showNumbers: true,
    showLabels: true,
    ticks: 1,
    labels: { x: 'x', y: 'y' },
    origin: { x: 0, y: 0 },
  },
  viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
  elements: { points: [], graphs: [] },
})

function buildAttachment(kind: AttachmentKind, layout: GraphLayout): QuestionAttachment {
  if (kind === 'svg') return { kind, layout, svg: defaultSvg() }
  if (kind === 'geometry') return { kind, layout, geometry: defaultGeometry() }
  return { kind, layout, axis: defaultAxis(), displaySize: 'full' }
}

interface AttachmentEditorProps {
  blockId: string
  attachment?: QuestionAttachment
  onChange: (attachment: QuestionAttachment | undefined) => void
}

/**
 * Editor for the optional `attachment` field on question blocks. Renders a
 * kind selector (svg / geometry / axis), a layout selector, and the matching
 * sub-editor. The whole attachment is optional — toggling it off strips the
 * field so the question renders as it does today.
 */
export const AttachmentEditor: React.FC<AttachmentEditorProps> = ({
  blockId,
  attachment,
  onChange,
}) => {
  const enabled = attachment !== undefined
  const layout = attachment?.layout ?? DEFAULT_LAYOUT

  // Remember the last configured attachment so toggling off → on within a
  // session restores prior work instead of wiping it back to a default SVG.
  const lastAttachmentRef = React.useRef<QuestionAttachment | undefined>(attachment)
  React.useEffect(() => {
    if (attachment !== undefined) {
      lastAttachmentRef.current = attachment
    }
  }, [attachment])

  const handleToggle = () => {
    if (enabled) {
      onChange(undefined)
    } else {
      onChange(lastAttachmentRef.current ?? buildAttachment('svg', DEFAULT_LAYOUT))
    }
  }

  const handleKindChange = (kind: AttachmentKind) => {
    onChange(buildAttachment(kind, layout))
  }

  const handleLayoutChange = (nextLayout: GraphLayout) => {
    if (!attachment) return
    onChange({ ...attachment, layout: nextLayout } as QuestionAttachment)
  }

  return (
    <div className="attachment-editor">
      <label className="question-editor-label" style={{ display: 'flex', gap: '0.5rem' }}>
        <input type="checkbox" checked={enabled} onChange={handleToggle} />
        <span>Attach a sketch (SVG / geometry / axis)</span>
      </label>

      {enabled && attachment && (
        <>
          <div className="question-editor-section">
            <label className="question-editor-label">Attachment type</label>
            <select
              className="w-full p-2 border border-input rounded-md bg-background text-foreground"
              value={attachment.kind}
              onChange={(e) => handleKindChange(e.target.value as AttachmentKind)}
            >
              <option value="svg">SVG (raw markup)</option>
              <option value="geometry">Geometry</option>
              <option value="axis">Axis / Graph</option>
            </select>
          </div>

          <div className="question-editor-section">
            <label className="question-editor-label">Layout</label>
            <select
              className="w-full p-2 border border-input rounded-md bg-background text-foreground"
              value={layout}
              onChange={(e) => handleLayoutChange(e.target.value as GraphLayout)}
            >
              {LAYOUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {attachment.kind === 'svg' && (
            <SvgAttachmentInputs
              value={attachment.svg}
              onChange={(svg) => onChange({ ...attachment, svg })}
            />
          )}

          {attachment.kind === 'geometry' && (
            <div className="question-editor-section">
              <GeometrySpecEditor
                canvasId={`attachment-geo-${blockId}`}
                spec={attachment.geometry}
                onChange={(geometry) => onChange({ ...attachment, geometry })}
              />
            </div>
          )}

          {attachment.kind === 'axis' && (
            <>
              <div className="question-editor-section">
                <div className="canvas-config-row">
                  <div className="panel-field">
                    <span className="panel-field-label">Display Size</span>
                    <select
                      className="panel-field-select"
                      value={attachment.displaySize || 'full'}
                      onChange={(e) =>
                        onChange({
                          ...attachment,
                          displaySize: e.target.value as 'small' | 'medium' | 'large' | 'full',
                        })
                      }
                    >
                      <option value="small">Small (33%)</option>
                      <option value="medium">Medium (50%)</option>
                      <option value="large">Large (75%)</option>
                      <option value="full">Full Width (100%)</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="question-editor-section">
                <AxisSpecEditor
                  canvasId={`attachment-axis-${blockId}`}
                  spec={attachment.axis}
                  onChange={(axis) => onChange({ ...attachment, axis })}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

interface SvgAttachmentInputsProps {
  value: SvgAttachmentContent
  onChange: (value: SvgAttachmentContent) => void
}

const SvgAttachmentInputs: React.FC<SvgAttachmentInputsProps> = ({ value, onChange }) => {
  return (
    <>
      <div className="question-editor-section">
        <label className="question-editor-label">SVG Code</label>
        <textarea
          className="svg-editor-textarea"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          spellCheck={false}
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Alt Text</label>
        <input
          type="text"
          className="svg-editor-alt-input"
          value={value.altText || ''}
          onChange={(e) => onChange({ ...value, altText: e.target.value })}
          placeholder="Describe this image for accessibility..."
        />
      </div>

      <div className="question-editor-section">
        <label className="question-editor-label">Caption (optional)</label>
        <InlineRichTextEditor
          value={
            value.caption ?? {
              type: 'rich_text',
              format: 'md-math-v1',
              value: '',
              mediaIds: [],
            }
          }
          onChange={(caption) => {
            const hasContent = caption.value.trim().length > 0 || caption.mediaIds.length > 0
            onChange({ ...value, caption: hasContent ? caption : undefined })
          }}
          placeholder="Optional caption shown below the sketch"
        />
      </div>
    </>
  )
}
