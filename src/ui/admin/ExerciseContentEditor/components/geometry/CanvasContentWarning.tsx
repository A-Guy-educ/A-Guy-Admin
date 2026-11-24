'use client'

import React from 'react'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import { fitCanvasToContent, resolveCanvasBox } from '@/infra/utils/graphics/geometry-canvas-size'
import { isContentOutsideBox } from '@/infra/utils/graphics/geometry-content-bounds'

interface CanvasContentWarningProps {
  canvas: GeometrySpecV1['canvas']
  elements: Pick<GeometrySpecV1['elements'], 'points' | 'circles'>
  onChange: (canvas: GeometrySpecV1['canvas']) => void
}

/**
 * Shown when a point or circle sits outside the bounding box (e.g. after a
 * drag) — students would see it cut off. Offers a one-click refit instead of
 * refitting automatically, which would shift the view mid-drag.
 */
export const CanvasContentWarning: React.FC<CanvasContentWarningProps> = ({
  canvas,
  elements,
  onChange,
}) => {
  if (!isContentOutsideBox(resolveCanvasBox(canvas), elements.points, elements.circles)) {
    return null
  }
  return (
    <div className="viewport-warning-banner">
      Some points are outside the visible area and will be cut off for students.{' '}
      <button
        type="button"
        className="canvas-content-warning-fit"
        onClick={() => onChange(fitCanvasToContent(canvas, elements.points, elements.circles))}
      >
        Fit to content
      </button>
    </div>
  )
}
