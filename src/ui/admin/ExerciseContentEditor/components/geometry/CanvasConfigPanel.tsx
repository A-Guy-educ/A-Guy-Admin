'use client'

import React from 'react'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import { getDefaultCanvasBackground } from '@/infra/contracts/graphics/textColors'
import { SKETCH_HEIGHT_PX } from '@/infra/utils/graphics/board-sizing'
import {
  applyCanvasWidth,
  deriveCanvasWidth,
  fitCanvasToContent,
  isExtremeRatio,
} from '@/infra/utils/graphics/geometry-canvas-size'
import { CanvasWidthField } from './CanvasWidthField'

interface CanvasConfigPanelProps {
  canvas: GeometrySpecV1['canvas']
  /** Content the "Fit to content" button fits the bounding box around. */
  elements: Pick<GeometrySpecV1['elements'], 'points' | 'circles'>
  onChange: (canvas: GeometrySpecV1['canvas']) => void
  /** Spec-level `interactive` flag; omitted in the spec means interactive. */
  interactive: boolean
  onInteractiveChange: (interactive: boolean) => void
}

export const CanvasConfigPanel: React.FC<CanvasConfigPanelProps> = ({
  canvas,
  elements,
  onChange,
  interactive,
  onInteractiveChange,
}) => {
  // Shown width comes from the box (what Web renders), never the stored width.
  const width = deriveCanvasWidth(canvas)

  return (
    <div className="canvas-config-panel">
      <div className="canvas-config-row">
        <CanvasWidthField
          width={width}
          onCommit={(next) => onChange(applyCanvasWidth(canvas, next))}
        />
        <div className="panel-field">
          <span className="panel-field-label">Background</span>
          <input
            type="color"
            className="panel-color-input"
            value={canvas.background || getDefaultCanvasBackground()}
            onChange={(e) => onChange({ ...canvas, background: e.target.value })}
          />
        </div>
        <label className="panel-checkbox-label">
          <input
            type="checkbox"
            checked={canvas.grid ?? false}
            onChange={(e) => onChange({ ...canvas, grid: e.target.checked })}
          />
          Grid
        </label>
        <label
          className="panel-checkbox-label"
          title="Students can hover, click and drag elements. Off = static picture."
        >
          <input
            type="checkbox"
            checked={interactive}
            onChange={(e) => onInteractiveChange(e.target.checked)}
          />
          Interactive
        </label>
      </div>
      <button
        type="button"
        className="panel-add-btn"
        onClick={() => onChange(fitCanvasToContent(canvas, elements.points, elements.circles))}
        title="Fit the view to the points and circles (10% padding)"
      >
        Fit to content
      </button>
      {isExtremeRatio(width / SKETCH_HEIGHT_PX) && (
        <div className="viewport-warning-banner">
          Very wide or tall sketches render small on the lesson page (width is capped at 75% of the
          column).
        </div>
      )}
    </div>
  )
}
