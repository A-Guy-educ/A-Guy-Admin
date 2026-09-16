'use client'

import React, { useCallback } from 'react'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import { CollapsibleSection } from '@/ui/admin/shared/CollapsibleSection'
import { AnglesPanel } from '../components/geometry/AnglesPanel'
import { CanvasConfigPanel } from '../components/geometry/CanvasConfigPanel'
import { CirclesPanel } from '../components/geometry/CirclesPanel'
import { GeometryCanvasWithToolbar } from '../components/geometry/GeometryCanvasWithToolbar'
import { LinesPanel } from '../components/geometry/LinesPanel'
import { PointsPanel } from '../components/geometry/PointsPanel'
import { ShapesPanel } from '../components/geometry/ShapesPanel'
import { TextsPanel } from '../components/geometry/TextsPanel'
import { VectorsPanel } from '../components/geometry/VectorsPanel'

interface GeometrySpecEditorProps {
  canvasId: string
  spec: GeometrySpecV1
  onChange: (spec: GeometrySpecV1) => void
}

/**
 * Panels + canvas for editing a GeometrySpecV1. Extracted from GeometryEditor
 * so both the standalone `question_geometry` block editor and the attachment
 * editor render the same UI.
 */
export const GeometrySpecEditor: React.FC<GeometrySpecEditorProps> = ({
  canvasId,
  spec,
  onChange,
}) => {
  const updateSpec = useCallback(
    (updates: Partial<GeometrySpecV1>) => {
      onChange({ ...spec, ...updates })
    },
    [spec, onChange],
  )

  const updateElements = useCallback(
    (updates: Partial<GeometrySpecV1['elements']>) => {
      updateSpec({ elements: { ...spec.elements, ...updates } })
    },
    [spec, updateSpec],
  )

  const handlePointMoved = useCallback(
    (name: string, x: number, y: number) => {
      const newPoints = spec.elements.points.map((p) => (p.name === name ? { ...p, x, y } : p))
      updateElements({ points: newPoints })
    },
    [spec.elements.points, updateElements],
  )

  const handleMultiPointMoved = useCallback(
    (updates: Array<{ name: string; x: number; y: number }>) => {
      const map = new Map(updates.map((u) => [u.name, u]))
      const newPoints = spec.elements.points.map((p) => {
        const u = map.get(p.name)
        return u ? { ...p, x: u.x, y: u.y } : p
      })
      updateElements({ points: newPoints })
    },
    [spec.elements.points, updateElements],
  )

  const handlePointAdded = useCallback(
    (x: number, y: number) => {
      const nextIndex = spec.elements.points.length + 1
      const name = String.fromCharCode(64 + nextIndex)
      updateElements({
        points: [...spec.elements.points, { name, x, y, position: 'r' as const, color: '#1a1a2e' }],
      })
    },
    [spec.elements.points, updateElements],
  )

  const handlePointLabelMoved = useCallback(
    (name: string, position: string) => {
      type PointPosition = GeometrySpecV1['elements']['points'][number]['position']
      const newPoints = spec.elements.points.map((p) =>
        p.name === name ? { ...p, position: position as PointPosition } : p,
      )
      updateElements({ points: newPoints })
    },
    [spec.elements.points, updateElements],
  )

  const handleGridToggle = useCallback(
    (showGrid: boolean) => {
      updateSpec({ canvas: { ...spec.canvas, grid: showGrid } })
    },
    [spec.canvas, updateSpec],
  )

  const handleTextMoved = useCallback(
    (index: number, x: number, y: number) => {
      const newTexts = (spec.elements.texts || []).map((t, i) =>
        i === index ? { ...t, place: { ...t.place, x, y } } : t,
      )
      updateElements({ texts: newTexts })
    },
    [spec.elements.texts, updateElements],
  )

  return (
    <div className="graph-editor-layout">
      <div className="graph-editor-form">
        <CollapsibleSection title="Canvas" defaultExpanded={false}>
          <CanvasConfigPanel canvas={spec.canvas} onChange={(canvas) => updateSpec({ canvas })} />
        </CollapsibleSection>

        <CollapsibleSection title={`Points (${spec.elements.points.length})`} defaultExpanded>
          <PointsPanel
            points={spec.elements.points}
            onChange={(points) => updateElements({ points })}
          />
        </CollapsibleSection>

        <CollapsibleSection title={`Lines (${spec.elements.lines.length})`} defaultExpanded={false}>
          <LinesPanel
            lines={spec.elements.lines}
            points={spec.elements.points}
            onChange={(lines) => updateElements({ lines })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={`Circles (${spec.elements.circles.length})`}
          defaultExpanded={false}
        >
          <CirclesPanel
            circles={spec.elements.circles}
            points={spec.elements.points}
            onChange={(circles) => updateElements({ circles })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={`Angles (${spec.elements.angles.length})`}
          defaultExpanded={false}
        >
          <AnglesPanel
            angles={spec.elements.angles}
            points={spec.elements.points}
            onChange={(angles) => updateElements({ angles })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={`Vectors (${(spec.elements.vectors || []).length})`}
          defaultExpanded={false}
        >
          <VectorsPanel
            vectors={spec.elements.vectors || []}
            points={spec.elements.points}
            onChange={(vectors) => updateElements({ vectors })}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Shapes" defaultExpanded={false}>
          <ShapesPanel
            triangles={spec.elements.triangles || []}
            rectangles={spec.elements.rectangles || []}
            points={spec.elements.points}
            onTrianglesChange={(triangles) => updateElements({ triangles })}
            onRectanglesChange={(rectangles) => updateElements({ rectangles })}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={`Texts (${(spec.elements.texts || []).length})`}
          defaultExpanded={false}
        >
          <TextsPanel
            texts={spec.elements.texts || []}
            onChange={(texts) => updateElements({ texts })}
          />
        </CollapsibleSection>
      </div>

      <GeometryCanvasWithToolbar
        id={canvasId}
        geometry={spec}
        onPointMoved={handlePointMoved}
        onMultiPointMoved={handleMultiPointMoved}
        onPointAdded={handlePointAdded}
        onGridToggle={handleGridToggle}
        onTextMoved={handleTextMoved}
        onPointLabelMoved={handlePointLabelMoved}
      />
    </div>
  )
}
