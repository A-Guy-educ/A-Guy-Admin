'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { JXGBoard, JXGElement } from 'jsxgraph'
import { JSXGraphBoard } from '../shared/JSXGraphBoard'
import { resolveViewport } from '@/infra/utils/graphics/viewport-utils'
import { createLocusOnBoard } from '@/ui/shared/exerciserenderer/graphics/axisElements'

/** Map a compass label position to a JSXGraph pixel offset. */
function mapLabelOffset(pos?: string): [number, number] {
  const d = 14
  const map: Record<string, [number, number]> = {
    tl: [-d, d],
    t: [0, d],
    tr: [d, d],
    l: [-d, 0],
    r: [d, 0],
    bl: [-d, -d],
    b: [0, -d],
    br: [d, -d],
    m: [0, 0],
    middle: [0, 0],
  }
  return map[pos || 'tr'] || [d, d]
}

interface AxisCanvasProps {
  id: string
  axis: AxisSpecV1
  onPointMoved?: (index: number, x: number, y: number) => void
}

const MIN_BOARD_PX = 320
const MAX_BOARD_PX = 600
const DEFAULT_BOARD_PX = 500

export const AxisCanvas: React.FC<AxisCanvasProps> = ({ id, axis, onPointMoved }) => {
  const boardRef = useRef<JXGBoard | null>(null)
  const isSyncingRef = useRef(false)
  const elementsRef = useRef<Map<string, JXGElement>>(new Map())
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Match the board pixel size to the surrounding CSS column so it fills the
  // 55%-wide canvas slot instead of sitting as a small fixed square inside
  // it. The board stays square (so proportion changes never reshape the
  // layout) and is clamped between MIN_BOARD_PX and MAX_BOARD_PX.
  const [boardSize, setBoardSize] = useState<number>(DEFAULT_BOARD_PX)

  const syncToBoard = useCallback(() => {
    const board = boardRef.current
    if (!board) return

    isSyncingRef.current = true
    board.suspendUpdate()

    try {
      const existingIds = new Set(elementsRef.current.keys())
      const newIds = new Set<string>()

      // Sync points — recreate when label offset OR label presence changes:
      // JSXGraph doesn't reliably update label.offset via setAttribute, and it
      // won't lazily create a label sub-element for a point that was built
      // with withLabel: false, so flipping withLabel on later via setAttribute
      // silently no-ops. Baking `hasLabel` into the recreate key forces a
      // fresh board.create() the first time the author adds label text.
      axis.elements.points.forEach((point, index) => {
        const elemId = `point-${index}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        const labelOffset = mapLabelOffset(point.labelPosition)
        const hasLabel = !!point.label
        const labelKey = `${labelOffset.join(',')}|${hasLabel ? '1' : '0'}`
        const pointSize = point.size ?? (point.type === 'hole' ? 4 : 3)

        const prevKey = existing
          ? (existing as unknown as { _labelKey?: string })._labelKey
          : undefined

        // Holes render as an unfilled ring — thicker stroke makes the ring
        // visible. Explicitly set strokeWidth on both paths so switching a
        // hole back to a plain point actually resets it (previously the
        // hole's strokeWidth: 2 lingered after the type change).
        const strokeWidth = point.type === 'hole' ? 2 : 1

        if (existing && existing.moveTo && prevKey === labelKey) {
          existing.moveTo([point.x, point.y])
          // Re-apply everything else the author might have changed — size,
          // color, hole/point/text swap, label text/visibility. Without this,
          // editing size or color silently no-ops until the label direction
          // is also toggled and forces a full recreation.
          existing.setAttribute({
            name: point.label || '',
            size: pointSize,
            color: point.color || '#3366cc',
            fillColor: point.type === 'hole' ? '#ffffff' : point.color || '#3366cc',
            strokeColor: point.color || '#3366cc',
            strokeWidth,
            withLabel: !!point.label,
            visible: point.type !== 'floating_text',
          })
        } else {
          if (existing) {
            board.removeObject(existing)
            elementsRef.current.delete(elemId)
          }

          const attrs: Record<string, unknown> = {
            name: point.label || '',
            size: pointSize,
            color: point.color || '#3366cc',
            fillColor: point.type === 'hole' ? '#ffffff' : point.color || '#3366cc',
            strokeColor: point.color || '#3366cc',
            strokeWidth,
            fixed: false,
            withLabel: !!point.label,
            visible: point.type !== 'floating_text',
            label: {
              offset: labelOffset,
              fontSize: 12,
              fontFamily: 'Times New Roman',
            },
          }

          const el = board.create('point', [point.x, point.y], attrs)
          el.on('drag', () => {
            if (isSyncingRef.current) return
            if (el.X && el.Y) {
              onPointMoved?.(index, Math.round(el.X() * 100) / 100, Math.round(el.Y() * 100) / 100)
            }
          })
          ;(el as unknown as { _labelKey?: string })._labelKey = labelKey
          elementsRef.current.set(elemId, el)
        }
      })

      // Sync graphs (function graphs)
      axis.elements.graphs.forEach((graph, index) => {
        const elemId = `graph-${index}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }

        try {
          const fn = new Function('x', `return ${graph.fn.replace(/\^/g, '**')}`)
          const dashMap: Record<string, number> = { solid: 0, dashed: 2, dotted: 4 }
          const el = board.create('functiongraph', [fn], {
            strokeColor: graph.color || '#3366cc',
            strokeWidth: graph.thickness || 2,
            dash: dashMap[graph.style] || 0,
          })
          elementsRef.current.set(elemId, el)
        } catch {
          // Invalid function expression - skip rendering
        }
      })

      // Sync asymptotes
      const vertAsym = axis.elements.asymptotesVertical || []
      vertAsym.forEach((xVal, index) => {
        const elemId = `vasym-${index}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }
        const el = board.create(
          'line',
          [
            [xVal, 0],
            [xVal, 1],
          ],
          {
            strokeColor: '#999999',
            dash: 3,
            strokeWidth: 1,
            fixed: true,
            straightFirst: true,
            straightLast: true,
          },
        )
        elementsRef.current.set(elemId, el)
      })

      const horizAsym = axis.elements.asymptotesHorizontal || []
      horizAsym.forEach((yVal, index) => {
        const elemId = `hasym-${index}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }
        const el = board.create(
          'line',
          [
            [0, yVal],
            [1, yVal],
          ],
          {
            strokeColor: '#999999',
            dash: 3,
            strokeWidth: 1,
            fixed: true,
            straightFirst: true,
            straightLast: true,
          },
        )
        elementsRef.current.set(elemId, el)
      })

      // Sync line segments between points
      const linesBetween = axis.elements.lineBetweenPoints || []
      linesBetween.forEach((line, index) => {
        const elemId = `lbp-${index}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }
        const dashMap: Record<string, number> = { solid: 0, dashed: 2, dotted: 4 }
        const el = board.create(
          'segment',
          [
            [line.a.x, line.a.y],
            [line.b.x, line.b.y],
          ],
          {
            strokeColor: line.color || '#000000',
            strokeWidth: line.thickness || 2,
            dash: dashMap[line.style] || 0,
            fixed: true,
            lastArrow: line.arrow ? { type: 1, size: 6 } : false,
          },
        )
        elementsRef.current.set(elemId, el)
      })

      // Sync geometric loci (implicit curves: x^2+y^2=1, x=c, y=c, etc.)
      const loci = axis.elements.geometricLoci || []
      loci.forEach((locus, index) => {
        const elemId = `locus-${index}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }
        const el = createLocusOnBoard(board as unknown as JXG.Board, locus)
        if (el) elementsRef.current.set(elemId, el as unknown as JXGElement)
      })

      // Remove stale elements
      for (const oldId of existingIds) {
        if (!newIds.has(oldId)) {
          const el = elementsRef.current.get(oldId)
          if (el) {
            board.removeObject(el)
            elementsRef.current.delete(oldId)
          }
        }
      }
    } finally {
      board.unsuspendUpdate()
      isSyncingRef.current = false
    }
  }, [axis, onPointMoved])

  const syncToBoardRef = useRef(syncToBoard)
  syncToBoardRef.current = syncToBoard

  useEffect(() => {
    syncToBoard()
  }, [syncToBoard])

  const handleBoardReady = useCallback((board: JXGBoard) => {
    boardRef.current = board
    elementsRef.current.clear()
    syncToBoardRef.current()
  }, [])

  // Board stays square (proportion changes never resize the DOM — they just
  // expand the visible bounding box below). Instead of a hardcoded 500×500,
  // measure the surrounding `.graph-editor-canvas` column and match it up
  // to the max, so the board fills the 55% slot on wide screens instead of
  // leaving dead space around a small fixed square.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const recompute = () => {
      const w = el.clientWidth
      if (!w) return
      const next = Math.max(MIN_BOARD_PX, Math.min(MAX_BOARD_PX, Math.floor(w)))
      setBoardSize((prev) => (prev === next ? prev : next))
    }
    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const bbox = useMemo<[number, number, number, number]>(() => {
    const resolved = resolveViewport(axis)
    const xRange = resolved.xMax - resolved.xMin
    const yRange = resolved.yMax - resolved.yMin
    const proportion = axis.proportion ?? 1
    if (xRange <= 0 || yRange <= 0) {
      return [resolved.xMin, resolved.yMax, resolved.xMax, resolved.yMin]
    }
    // Board is square, so containerAspect is always 1.
    const desiredAspect = (xRange * proportion) / yRange
    let visibleXRange = xRange
    let visibleYRange = yRange
    if (desiredAspect > 1) {
      // Requested aspect wider than square — grow y to fit (author sees
      // additional plane above/below their configured viewport).
      visibleYRange = xRange * proportion
    } else if (desiredAspect < 1) {
      // Requested aspect taller — grow x instead.
      visibleXRange = yRange / proportion
    }
    const xCenter = (resolved.xMin + resolved.xMax) / 2
    const yCenter = (resolved.yMin + resolved.yMax) / 2
    return [
      xCenter - visibleXRange / 2,
      yCenter + visibleYRange / 2,
      xCenter + visibleXRange / 2,
      yCenter - visibleYRange / 2,
    ]
  }, [axis])

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <JSXGraphBoard
        id={id}
        width={boardSize}
        height={boardSize}
        boundingBox={bbox}
        showAxis
        showGrid={axis.grid.enabled}
        axisConfig={{
          showNumbers: axis.axes.showNumbers,
          showLabels: axis.axes.showLabels,
          ticks: axis.axes.ticks,
          labels: axis.axes.labels,
          tickPosition: axis.axes.tickPosition ?? { x: 'default', y: 'default' },
        }}
        onBoardReady={handleBoardReady}
      />
    </div>
  )
}
