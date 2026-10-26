'use client'

import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import {
  getDefaultAngleColor,
  getAdminCanvasBackground,
  getDefaultCanvasElementColor,
  sizeScaleToPixels,
} from '@/infra/contracts/graphics/textColors'
import {
  snapAngleLabelPosition,
  type AngleLabelPosition,
  type BoardPixelScale,
} from '@/infra/utils/graphics/angle-label'
import { collectEdgeAngles, pickSafeCompassPosition } from '@/infra/utils/graphics/point-label'
import {
  ANGLE_LABEL_LAYER,
  angleFillAttrs,
  angleLabelCssStyle,
  angleLabelFontSize,
  angleMarkerRadiusPx,
  angleOutlineAttrs,
  computeSpecAngleMarker,
  type Vec,
} from '@/ui/shared/exerciserenderer/graphics/geometryAngleMarkers'
import type { JXGBoard, JXGElement } from 'jsxgraph'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JSXGraphBoard } from '../shared/JSXGraphBoard'

interface PointUpdate {
  name: string
  x: number
  y: number
}

interface GeometryCanvasProps {
  id: string
  geometry: GeometrySpecV1
  interactionMode?: 'move' | 'addPoint' | 'moveSketch'
  onPointMoved?: (name: string, x: number, y: number) => void
  onMultiPointMoved?: (updates: PointUpdate[]) => void
  onCanvasClick?: (x: number, y: number) => void
  onTextMoved?: (index: number, x: number, y: number) => void
  onPointLabelMoved?: (name: string, position: string) => void
  onAngleLabelMoved?: (index: number, position: AngleLabelPosition) => void
}

// Fallback pixel width used on the very first render, before the
// ResizeObserver measures the surrounding `.graph-editor-canvas` column.
const INITIAL_BOARD_PX = 500
const MIN_BOARD_PX = 320
const MAX_BOARD_PX = 600

// Equality-marker tick styling, in pixels so ticks stay consistent across
// boards with different user-unit scales.
const EQ_TICK_LENGTH_PX = 10.4
const EQ_TICK_SPACING_PX = 5

const round1 = (n: number) => Math.round(n * 10) / 10

/** Map compass direction to a pixel [x, y] offset for JSXGraph labels. The
 *  base distance was reduced from 15px → 11px (~27% closer) so labels sit
 *  snugly next to the dot instead of floating well off the sketch. */
function mapLabelOffset(pos?: string): [number, number] {
  const d = 11
  const map: Record<string, [number, number]> = {
    tl: [-d, d],
    t: [0, d],
    tr: [d, d],
    l: [-d, 0],
    r: [d, 0],
    bl: [-d, -d],
    b: [0, -d],
    br: [d, -d],
  }
  return map[pos || 'r'] || [d, 0]
}

function angleToLabelPosition(angleDeg: number): string {
  const normalized = ((angleDeg % 360) + 360) % 360
  const idx = Math.round(normalized / 45) % 8
  return ['r', 'tr', 't', 'tl', 'l', 'bl', 'b', 'br'][idx]
}

/** JSXGraph exposes pixel-per-user-unit scales on the board at runtime. */
function getBoardScale(board: JXGBoard): BoardPixelScale {
  const b = board as unknown as { unitX?: number; unitY?: number }
  return { unitX: b.unitX || 1, unitY: b.unitY || 1 }
}

export const GeometryCanvas: React.FC<GeometryCanvasProps> = ({
  id,
  geometry,
  interactionMode = 'move',
  onPointMoved,
  onMultiPointMoved,
  onCanvasClick,
  onTextMoved,
  onPointLabelMoved,
  onAngleLabelMoved,
}) => {
  const boardRef = useRef<JXGBoard | null>(null)
  const isSyncingRef = useRef(false)
  const isDraggingRef = useRef(false)
  const elementsRef = useRef<Map<string, JXGElement>>(new Map())
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Match the board pixel size to the surrounding CSS column so the canvas
  // fills the 55%-wide slot instead of sitting as a small fixed rectangle
  // inside it. Aspect is derived from the geometry's bounding box below.
  const [containerWidth, setContainerWidth] = useState<number>(INITIAL_BOARD_PX)
  const modeRef = useRef(interactionMode)
  const onCanvasClickRef = useRef(onCanvasClick)
  const onPointMovedRef = useRef(onPointMoved)
  const onMultiPointMovedRef = useRef(onMultiPointMoved)
  const onTextMovedRef = useRef(onTextMoved)
  const onPointLabelMovedRef = useRef(onPointLabelMoved)
  const onAngleLabelMovedRef = useRef(onAngleLabelMoved)
  // Snapshot of all point positions captured on sketch-drag start, so each
  // move handler shifts the sketch by (cursor - startCursor) against the
  // original positions rather than accumulating drift.
  const sketchDragRef = useRef<{
    startX: number
    startY: number
    points: Array<{ name: string; x: number; y: number }>
    lastUpdates?: PointUpdate[]
  } | null>(null)
  const geometryRef = useRef(geometry)
  modeRef.current = interactionMode
  onCanvasClickRef.current = onCanvasClick
  onPointMovedRef.current = onPointMoved
  onMultiPointMovedRef.current = onMultiPointMoved
  onTextMovedRef.current = onTextMoved
  onPointLabelMovedRef.current = onPointLabelMoved
  onAngleLabelMovedRef.current = onAngleLabelMoved
  geometryRef.current = geometry

  const syncToBoard = useCallback(() => {
    const board = boardRef.current
    if (!board || isDraggingRef.current) return

    isSyncingRef.current = true
    board.suspendUpdate()

    try {
      const existingIds = new Set(elementsRef.current.keys())
      const newIds = new Set<string>()

      const recreatedPoints = syncPoints(
        board,
        geometry,
        newIds,
        elementsRef,
        isSyncingRef,
        isDraggingRef,
        onPointMovedRef,
        onPointLabelMovedRef,
        modeRef,
      )

      // When points are recreated (e.g. label position change), dependent
      // elements hold stale JSXGraph references.  Remove them so the sync
      // functions below recreate them against the new point objects.
      if (recreatedPoints.size > 0) {
        for (const [id, el] of elementsRef.current) {
          if (id.startsWith('point-')) continue
          if (id.startsWith('text-')) continue
          board.removeObject(el)
          elementsRef.current.delete(id)
        }
      }

      syncSegments(board, geometry, newIds, elementsRef)
      syncLineLabels(board, geometry, newIds, elementsRef)
      syncCircles(board, geometry, newIds, elementsRef)
      syncAngles(
        board,
        geometry,
        newIds,
        elementsRef,
        isSyncingRef,
        isDraggingRef,
        onAngleLabelMovedRef,
      )
      syncPolygons(
        board,
        geometry,
        newIds,
        elementsRef,
        isSyncingRef,
        isDraggingRef,
        onMultiPointMovedRef,
      )
      syncTexts(board, geometry, newIds, elementsRef, isSyncingRef, isDraggingRef, onTextMovedRef)
      syncEqualSegments(board, geometry, newIds, elementsRef)
      syncEqualAngles(board, geometry, newIds, elementsRef)

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
  }, [geometry])

  const syncToBoardRef = useRef(syncToBoard)
  syncToBoardRef.current = syncToBoard

  useEffect(() => {
    syncToBoard()
  }, [syncToBoard])

  const handleBoardReady = useCallback((board: JXGBoard) => {
    boardRef.current = board
    elementsRef.current.clear()
    syncToBoardRef.current()
    const b = board as unknown as {
      on: (event: string, handler: (e: unknown) => void) => void
      getUsrCoordsOfMouse: (e: unknown) => number[]
      suspendUpdate: () => void
      unsuspendUpdate: () => void
      update: () => void
    }
    const getUsr = (e: unknown): [number, number] | null => {
      const coords = b.getUsrCoordsOfMouse(e)
      const x = coords.length > 2 ? coords[1] : coords[0]
      const y = coords.length > 2 ? coords[2] : coords[1]
      if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) return null
      return [x, y]
    }
    b.on('down', (e: unknown) => {
      if (modeRef.current === 'addPoint') {
        const pt = getUsr(e)
        if (pt) onCanvasClickRef.current?.(round1(pt[0]), round1(pt[1]))
        return
      }
      if (modeRef.current === 'moveSketch') {
        const pt = getUsr(e)
        if (!pt) return
        sketchDragRef.current = {
          startX: pt[0],
          startY: pt[1],
          points: geometryRef.current.elements.points.map((p) => ({
            name: p.name,
            x: p.x,
            y: p.y,
          })),
        }
        isDraggingRef.current = true
      }
    })
    b.on('move', (e: unknown) => {
      if (modeRef.current !== 'moveSketch' || !sketchDragRef.current) return
      const pt = getUsr(e)
      if (!pt) return
      const dx = pt[0] - sketchDragRef.current.startX
      const dy = pt[1] - sketchDragRef.current.startY
      const updates: PointUpdate[] = sketchDragRef.current.points.map((p) => ({
        name: p.name,
        x: round1(p.x + dx),
        y: round1(p.y + dy),
      }))
      // Move the JSXGraph point elements live so dependent segments / circles
      // / angles track along. Spec state is flushed once on `up` to avoid a
      // React re-render per frame.
      isSyncingRef.current = true
      b.suspendUpdate()
      try {
        for (const u of updates) {
          const el = elementsRef.current.get(`point-${u.name}`) as unknown as
            | { moveTo?: (xy: [number, number]) => void }
            | undefined
          el?.moveTo?.([u.x, u.y])
        }
      } finally {
        b.unsuspendUpdate()
        isSyncingRef.current = false
      }
      sketchDragRef.current.lastUpdates = updates
    })
    b.on('up', () => {
      if (!sketchDragRef.current) return
      const final = sketchDragRef.current.lastUpdates
      sketchDragRef.current = null
      isDraggingRef.current = false
      if (final && final.length) onMultiPointMovedRef.current?.(final)
    })
  }, [])

  // In moveSketch mode, freeze individual-element drags (points, texts,
  // polygons, angle labels) so dragging grabs the whole sketch instead of
  // whatever element the pointer landed on. The sketch-drag handlers above
  // provide the global movement.
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const freeze = interactionMode === 'moveSketch'
    for (const [elemId, el] of elementsRef.current) {
      if (
        elemId.startsWith('point-') ||
        elemId.startsWith('text-') ||
        elemId.startsWith('triangle-') ||
        elemId.startsWith('rectangle-') ||
        elemId.startsWith('anglelabel-')
      ) {
        ;(el as unknown as { setAttribute?: (a: Record<string, unknown>) => void }).setAttribute?.({
          fixed: freeze,
        })
      }
    }
    ;(board as unknown as { update: () => void }).update()
  }, [interactionMode])

  // Nuke the browser's native HTML5 drag during moveSketch. CSS user-select +
  // onDragStart on the wrap only catch drags that originate inside the wrap;
  // the admin editor's parent containers (block body, row fields, selectable
  // text / img descendants) can also become the drag source — their dragstart
  // never bubbles into the wrap, so the browser renders a translucent ghost of
  // whichever ancestor Chrome picked. A capture-phase document listener blocks
  // every dragstart while the user is actively panning, and tears down the
  // moment they leave the mode.
  useEffect(() => {
    if (interactionMode !== 'moveSketch') return
    const block = (e: DragEvent) => e.preventDefault()
    document.addEventListener('dragstart', block, { capture: true })
    return () => document.removeEventListener('dragstart', block, { capture: true })
  }, [interactionMode])

  const { canvas } = geometry
  // Respect the geometry's own boundingBox (needed for content with negative
  // coordinates) — mirror the renderer logic so editor and rendered output
  // share the same viewport. Fall back to width/height-based box when unset.
  const bbox = useMemo<[number, number, number, number]>(
    () => canvas.boundingBox ?? [0, canvas.height, canvas.width, 0],
    [canvas.boundingBox, canvas.width, canvas.height],
  )

  // Measure the surrounding `.graph-editor-canvas` column so the board
  // fills it (clamped between MIN and MAX). Aspect below still comes from
  // the bounding box, so circles stay circular.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const recompute = () => {
      const w = el.clientWidth
      if (!w) return
      const next = Math.max(MIN_BOARD_PX, Math.min(MAX_BOARD_PX, Math.floor(w)))
      setContainerWidth((prev) => (prev === next ? prev : next))
    }
    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Fit the editor canvas into the measured column while preserving the
  // bounding box's aspect ratio. Without this the old 420×320 default warped
  // circles into ~1.3:1 ellipses even when the underlying box was square.
  //
  // Editor-only sizing: deliberately NOT routed through the shared
  // `computeBoardSize` helper. The student renderer caps every sketch at
  // 330px tall and 75% of its container, which is right for an exercise
  // page but too cramped for authoring. Authors need the full MIN/MAX
  // editor-column range so detail work (dragging points, labelling
  // vertices) stays legible.
  const { width: boardWidth, height: boardHeight } = useMemo(() => {
    const xRange = Math.abs(bbox[2] - bbox[0])
    const yRange = Math.abs(bbox[1] - bbox[3])
    const degenerate =
      !Number.isFinite(xRange) || !Number.isFinite(yRange) || xRange <= 0 || yRange <= 0
    if (degenerate || !containerWidth) {
      const square = Math.max(MIN_BOARD_PX, Math.min(MAX_BOARD_PX, containerWidth || MIN_BOARD_PX))
      return { width: square, height: square }
    }
    const aspect = xRange / yRange
    let w = Math.min(containerWidth, MAX_BOARD_PX)
    let h = w / aspect
    if (h > MAX_BOARD_PX) {
      h = MAX_BOARD_PX
      w = h * aspect
    }
    if (w < MIN_BOARD_PX) {
      w = MIN_BOARD_PX
      h = w / aspect
    }
    if (h < MIN_BOARD_PX) {
      h = MIN_BOARD_PX
      w = h * aspect
    }
    return { width: Math.min(w, containerWidth), height: h }
  }, [bbox, containerWidth])

  return (
    <div
      ref={wrapRef}
      className={`geo-canvas-wrap geo-canvas-wrap--${interactionMode}`}
      // In moveSketch mode the browser otherwise picks up pointerdown on the
      // SVG and starts a native HTML5 drag of the element — a ghost-image
      // floats around while the sketch-pan handler misfires. preventDefault
      // on dragstart blocks that. Paired with user-select: none and
      // touch-action: none in index.css.
      onDragStart={interactionMode === 'moveSketch' ? (e) => e.preventDefault() : undefined}
      draggable={interactionMode === 'moveSketch' ? false : undefined}
      style={{
        background: canvas.background || getAdminCanvasBackground(),
        width: '100%',
      }}
    >
      <JSXGraphBoard
        id={id}
        width={boardWidth}
        height={boardHeight}
        boundingBox={bbox}
        showGrid={canvas.grid ?? false}
        onBoardReady={handleBoardReady}
      />
    </div>
  )
}

type LabelEl = {
  X: () => number
  Y: () => number
  setAttribute: (attrs: Record<string, unknown>) => void
  on: (event: string, handler: () => void) => void
}
type PointElWithLabel = { X: () => number; Y: () => number; label?: LabelEl }

function syncPoints(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
  isSyncingRef: React.MutableRefObject<boolean>,
  isDraggingRef: React.MutableRefObject<boolean>,
  onPointMovedRef: React.RefObject<((name: string, x: number, y: number) => void) | undefined>,
  onPointLabelMovedRef: React.RefObject<((name: string, position: string) => void) | undefined>,
  modeRef: React.MutableRefObject<'move' | 'addPoint' | 'moveSketch'>,
): Set<string> {
  const recreated = new Set<string>()
  for (const point of geometry.elements.points) {
    const elemId = `point-${point.name}`
    newIds.add(elemId)
    const existing = elementsRef.current.get(elemId)

    const pointColor = point.color ?? getDefaultCanvasElementColor()
    // Fallback matches the authored default (2) so legacy data without a size
    // field renders at the new default instead of the pre-change 4.
    const pointSize = point.size ?? 2
    // Nudge the label off any incident edge so it doesn't render on top of
    // the sketch. Author's compass choice is kept whenever it's already free.
    const safePosition = pickSafeCompassPosition(
      point.position,
      collectEdgeAngles(geometry, point.name),
    )
    const labelOffset = mapLabelOffset(safePosition)
    const labelVisible = point.labelVisible !== false
    // Include labelVisible in the change key so toggling it forces a full
    // recreation. JSXGraph's `withLabel` can't be flipped reliably via
    // setAttribute after the point exists.
    const labelKey = `${labelOffset.join(',')}|${labelVisible ? '1' : '0'}`

    // Check if label position changed — JSXGraph doesn't reliably update
    // label offset via setAttribute, so we force recreation.
    const prevKey = existing ? (existing as unknown as { _labelKey?: string })._labelKey : undefined
    if (existing && existing.moveTo && prevKey === labelKey) {
      existing.moveTo([point.x, point.y])
      existing.setAttribute({
        visible: point.visible !== false,
        name: point.name,
        fillColor: pointColor,
        strokeColor: pointColor,
        size: pointSize,
      })
    } else {
      if (existing) {
        board.removeObject(existing)
        elementsRef.current.delete(elemId)
        recreated.add(point.name)
      }
      const el = board.create('point', [point.x, point.y], {
        name: point.name,
        size: pointSize,
        fillColor: pointColor,
        strokeColor: pointColor,
        visible: point.visible !== false,
        fixed: modeRef.current === 'moveSketch',
        withLabel: labelVisible,
        label: {
          offset: labelOffset,
          fontSize: point.fontSize || 15,
          cssStyle: "font-family: 'Times New Roman', Times, serif;",
          visible: labelVisible,
        } as Record<string, unknown>,
      })
      el.on('drag', () => {
        if (isSyncingRef.current) return
        if (modeRef.current === 'moveSketch') return
        isDraggingRef.current = true
        if (el.X && el.Y) onPointMovedRef.current?.(point.name, round1(el.X()), round1(el.Y()))
      })
      el.on('up', () => {
        isDraggingRef.current = false
      })

      const elWithLabel = el as unknown as PointElWithLabel
      const labelEl = elWithLabel.label
      if (labelEl) {
        labelEl.setAttribute({ fixed: false })
        labelEl.on('drag', () => {
          if (isSyncingRef.current) return
          isDraggingRef.current = true
        })
        labelEl.on('up', () => {
          const dx = labelEl.X() - elWithLabel.X()
          const dy = labelEl.Y() - elWithLabel.Y()
          const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI)
          const snapped = angleToLabelPosition(angleDeg)
          onPointLabelMovedRef.current?.(point.name, snapped)
          isDraggingRef.current = false
        })
      }

      // Track label offset for change detection
      ;(el as unknown as { _labelKey?: string })._labelKey = labelKey
      elementsRef.current.set(elemId, el)
    }
  }
  return recreated
}

function syncSegments(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
) {
  for (let i = 0; i < geometry.elements.lines.length; i++) {
    const line = geometry.elements.lines[i]
    const elemId = `line-${line.from}-${line.to}`
    newIds.add(elemId)
    const fromEl = elementsRef.current.get(`point-${line.from}`)
    const toEl = elementsRef.current.get(`point-${line.to}`)
    if (!fromEl || !toEl) continue

    const existing = elementsRef.current.get(elemId)
    if (existing) {
      existing.setAttribute({
        strokeColor: line.color || getDefaultCanvasElementColor(),
        strokeWidth: line.thickness || 2,
        dash: line.style === 'dashed' ? 2 : 0,
      })
      continue
    }
    const el = board.create('segment', [fromEl, toEl], {
      strokeColor: line.color || getDefaultCanvasElementColor(),
      strokeWidth: line.thickness || 2,
      dash: line.style === 'dashed' ? 2 : 0,
      fixed: true,
    })
    elementsRef.current.set(elemId, el)
  }
}

function syncLineLabels(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
) {
  for (let i = 0; i < geometry.elements.lines.length; i++) {
    const line = geometry.elements.lines[i]
    const elemId = `linelabel-${line.from}-${line.to}`
    if (!line.label?.value) continue
    newIds.add(elemId)
    const fromEl = elementsRef.current.get(`point-${line.from}`)
    const toEl = elementsRef.current.get(`point-${line.to}`)
    if (!fromEl || !toEl) continue

    const existing = elementsRef.current.get(elemId)
    if (existing) {
      board.removeObject(existing)
      elementsRef.current.delete(elemId)
    }

    const f = fromEl as unknown as { X: () => number; Y: () => number }
    const t = toEl as unknown as { X: () => number; Y: () => number }
    // Scale offset to ~3% of canvas height so it's visible on large coordinate spaces
    const baseOffset = geometry.canvas.height * 0.03
    const userSign = line.label.position === 'b' ? -1 : 1
    // Compute offsetDist dynamically so dragging a point past a direction flip
    // keeps the label on the same screen side as the user requested, rather
    // than tracking the from→to perpendicular (see geometryElements.ts).
    const computeOffsetDist = (dx: number, len: number) => {
      const sign = Math.abs(dx) / len < 0.05 ? userSign : userSign * Math.sign(dx)
      return sign * baseOffset
    }
    const el = board.create(
      'text',
      [
        () => {
          const dx = t.X() - f.X()
          const dy = t.Y() - f.Y()
          const len = Math.sqrt(dx * dx + dy * dy) || 1
          return (f.X() + t.X()) / 2 + (-dy / len) * computeOffsetDist(dx, len)
        },
        () => {
          const dx = t.X() - f.X()
          const dy = t.Y() - f.Y()
          const len = Math.sqrt(dx * dx + dy * dy) || 1
          return (f.Y() + t.Y()) / 2 + (dx / len) * computeOffsetDist(dx, len)
        },
        line.label.value,
      ],
      {
        fontSize: line.label.fontSize || 10,
        anchorX: 'middle',
        anchorY: 'middle',
        display: 'internal',
        cssStyle: "font-family: 'Times New Roman', Times, serif;",
        rotate: () => {
          const dx = t.X() - f.X()
          const dy = t.Y() - f.Y()
          let deg = (Math.atan2(dy, dx) * 180) / Math.PI
          if (deg > 90) deg -= 180
          if (deg < -90) deg += 180
          return deg
        },
        fixed: true,
      },
    )
    elementsRef.current.set(elemId, el)
  }
}

function syncCircles(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
) {
  for (let i = 0; i < geometry.elements.circles.length; i++) {
    const circle = geometry.elements.circles[i]
    const key = circle.through
      ? `${circle.center}-${circle.through}`
      : `${circle.center}-r${circle.radius}`
    const elemId = `circle-${key}`
    newIds.add(elemId)
    const centerEl = elementsRef.current.get(`point-${circle.center}`)
    if (!centerEl) continue

    const existing = elementsRef.current.get(elemId)
    if (existing) {
      existing.setAttribute({
        strokeColor: circle.color || getDefaultCanvasElementColor(),
        dash: circle.style === 'dashed' ? 2 : 0,
      })
      continue
    }
    const parents: unknown[] = circle.through
      ? [centerEl, elementsRef.current.get(`point-${circle.through}`) || centerEl]
      : [centerEl, circle.radius || 50]
    const el = board.create('circle', parents, {
      strokeColor: circle.color || getDefaultCanvasElementColor(),
      dash: circle.style === 'dashed' ? 2 : 0,
      fixed: true,
    })
    elementsRef.current.set(elemId, el)
  }
}

/** A curve whose points are recomputed on every board update, so it tracks
 *  its parent points live (e.g. during a sketch drag). */
function createLiveMarkerCurve(
  board: JXGBoard,
  points: () => Vec[],
  attrs: Record<string, unknown>,
): JXGElement {
  const el = board.create('curve', [[0], [0]], {
    fixed: true,
    highlight: false,
    ...attrs,
  })
  const curve = el as unknown as {
    dataX: number[]
    dataY: number[]
    updateDataArray: () => void
  }
  curve.updateDataArray = () => {
    const pts = points()
    curve.dataX = pts.map((p) => p.x)
    curve.dataY = pts.map((p) => p.y)
  }
  return el
}

function syncAngles(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
  isSyncingRef: React.MutableRefObject<boolean>,
  isDraggingRef: React.MutableRefObject<boolean>,
  onAngleLabelMovedRef: React.RefObject<
    ((index: number, position: AngleLabelPosition) => void) | undefined
  >,
) {
  for (let i = 0; i < geometry.elements.angles.length; i++) {
    const angle = geometry.elements.angles[i]
    const elemId = `angle-${angle.ray1}-${angle.center}-${angle.ray2}`
    const labelElemId = `anglelabel-${angle.ray1}-${angle.center}-${angle.ray2}`
    const arcElemId = `anglearc-${angle.ray1}-${angle.center}-${angle.ray2}`
    newIds.add(elemId)

    const ray1El = elementsRef.current.get(`point-${angle.ray1}`) as unknown as
      | {
          X: () => number
          Y: () => number
        }
      | undefined
    const centerEl = elementsRef.current.get(`point-${angle.center}`) as unknown as
      | {
          X: () => number
          Y: () => number
        }
      | undefined
    const ray2El = elementsRef.current.get(`point-${angle.ray2}`) as unknown as
      | {
          X: () => number
          Y: () => number
        }
      | undefined
    if (!ray1El || !centerEl || !ray2El) continue

    // Always remove and recreate so style/label changes take effect.
    const existing = elementsRef.current.get(elemId)
    if (existing) {
      board.removeObject(existing)
      elementsRef.current.delete(elemId)
    }
    const existingLabel = elementsRef.current.get(labelElemId)
    if (existingLabel) {
      board.removeObject(existingLabel)
      elementsRef.current.delete(labelElemId)
    }

    const existingArc = elementsRef.current.get(arcElemId)
    if (existingArc) {
      board.removeObject(existingArc)
      elementsRef.current.delete(arcElemId)
    }

    const color = angle.color || getDefaultAngleColor()
    // Marker is drawn in pixel space (shared with the renderer) so the arc
    // stays circular when unitX ≠ unitY. Recomputed on every board update so
    // it tracks the points live during a sketch drag.
    const liveMarker = () => {
      const { unitX, unitY } = getBoardScale(board)
      return computeSpecAngleMarker(
        angle,
        { x: centerEl.X(), y: centerEl.Y() },
        { x: ray1El.X(), y: ray1El.Y() },
        { x: ray2El.X(), y: ray2El.Y() },
        unitX,
        unitY,
      )
    }
    elementsRef.current.set(
      elemId,
      createLiveMarkerCurve(board, () => liveMarker()?.fill ?? [], angleFillAttrs(color)),
    )
    elementsRef.current.set(
      arcElemId,
      createLiveMarkerCurve(board, () => liveMarker()?.outline ?? [], angleOutlineAttrs(color)),
    )
    newIds.add(arcElemId)

    const labelAt = liveMarker()?.labelAt
    if (angle.label?.value && labelAt) {
      // Draggable text (not the marker's built-in label) so the admin can drag
      // to flip between inside and outside placement.
      const labelEl = board.create('text', [labelAt.x, labelAt.y, angle.label.value], {
        fontSize: angleLabelFontSize(angle),
        anchorX: 'middle',
        anchorY: 'middle',
        layer: ANGLE_LABEL_LAYER,
        cssStyle: angleLabelCssStyle(),
        strokeColor: color,
        color,
        fixed: false,
        highlight: true,
      })
      const capturedIndex = i
      labelEl.on('drag', () => {
        if (isSyncingRef.current) return
        isDraggingRef.current = true
      })
      labelEl.on('up', () => {
        const t = labelEl as unknown as { X: () => number; Y: () => number }
        const scale = getBoardScale(board)
        const snapped = snapAngleLabelPosition(
          scale,
          centerEl.X(),
          centerEl.Y(),
          t.X(),
          t.Y(),
          angleMarkerRadiusPx(angle, scale.unitX, scale.unitY),
        )
        onAngleLabelMovedRef.current?.(capturedIndex, snapped)
        isDraggingRef.current = false
      })
      elementsRef.current.set(labelElemId, labelEl)
      newIds.add(labelElemId)
    }
  }
}

function syncPolygons(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
  isSyncingRef: React.MutableRefObject<boolean>,
  isDraggingRef: React.MutableRefObject<boolean>,
  onMultiPointMovedRef: React.RefObject<((updates: PointUpdate[]) => void) | undefined>,
) {
  const triangles = geometry.elements.triangles || []
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i]
    const elemId = `triangle-${tri.points.join('-')}`
    newIds.add(elemId)

    // Remove existing so color/fill changes take effect
    const existingTri = elementsRef.current.get(elemId)
    if (existingTri) {
      board.removeObject(existingTri)
      elementsRef.current.delete(elemId)
    }

    const ptEls = tri.points.map((name) => elementsRef.current.get(`point-${name}`)).filter(Boolean)
    if (ptEls.length < 3) continue
    const el = board.create('polygon', ptEls, {
      borders: {
        strokeColor: tri.color || getDefaultCanvasElementColor(),
        strokeWidth: tri.thickness || 2,
      },
      fillColor: tri.fill || 'transparent',
      fillOpacity: tri.fill ? 0.3 : 0,
      hasInnerPoints: true,
    })
    addPolygonDragHandlers(el, tri.points, isSyncingRef, isDraggingRef, onMultiPointMovedRef)
    elementsRef.current.set(elemId, el)
  }

  const rectangles = geometry.elements.rectangles || []
  for (let i = 0; i < rectangles.length; i++) {
    const rect = rectangles[i]
    const elemId = `rectangle-${rect.points.join('-')}`
    newIds.add(elemId)

    // Remove existing so color/fill changes take effect
    const existingRect = elementsRef.current.get(elemId)
    if (existingRect) {
      board.removeObject(existingRect)
      elementsRef.current.delete(elemId)
    }

    const ptEls = rect.points
      .map((name) => elementsRef.current.get(`point-${name}`))
      .filter(Boolean)
    if (ptEls.length < 4) continue
    const el = board.create('polygon', ptEls, {
      borders: {
        strokeColor: rect.color || getDefaultCanvasElementColor(),
        strokeWidth: rect.thickness || 2,
      },
      fillColor: rect.fill || 'transparent',
      fillOpacity: rect.fill ? 0.3 : 0,
      hasInnerPoints: true,
    })
    addPolygonDragHandlers(el, rect.points, isSyncingRef, isDraggingRef, onMultiPointMovedRef)
    elementsRef.current.set(elemId, el)
  }
}

function addPolygonDragHandlers(
  polygon: JXGElement,
  pointNames: string[],
  isSyncingRef: React.MutableRefObject<boolean>,
  isDraggingRef: React.MutableRefObject<boolean>,
  onMultiPointMovedRef: React.RefObject<((updates: PointUpdate[]) => void) | undefined>,
) {
  const poly = polygon as unknown as { vertices: Array<{ X: () => number; Y: () => number }> }
  polygon.on('drag', () => {
    if (isSyncingRef.current) return
    isDraggingRef.current = true
    if (!poly.vertices) return
    const updates: PointUpdate[] = pointNames.map((name, idx) => ({
      name,
      x: round1(poly.vertices[idx].X()),
      y: round1(poly.vertices[idx].Y()),
    }))
    onMultiPointMovedRef.current?.(updates)
  })
  polygon.on('up', () => {
    isDraggingRef.current = false
  })
}

function syncTexts(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
  isSyncingRef: React.MutableRefObject<boolean>,
  isDraggingRef: React.MutableRefObject<boolean>,
  onTextMovedRef: React.RefObject<((index: number, x: number, y: number) => void) | undefined>,
) {
  const texts = geometry.elements.texts || []
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    const elemId = `text-${i}`
    newIds.add(elemId)

    let x = text.place?.x ?? 0
    let y = text.place?.y ?? 0

    if (text.on?.from && text.on?.to) {
      const fromEl = elementsRef.current.get(`point-${text.on.from}`)
      const toEl = elementsRef.current.get(`point-${text.on.to}`)
      if (fromEl && toEl) {
        const f = fromEl as unknown as { X: () => number; Y: () => number }
        const t = toEl as unknown as { X: () => number; Y: () => number }
        x = (f.X() + t.X()) / 2
        y = (f.Y() + t.Y()) / 2
      }
    }

    // Always remove and recreate — JSXGraph text elements don't support moveTo or
    // reliable in-place attribute updates. This matches the syncLineLabels pattern.
    const existing = elementsRef.current.get(elemId)
    if (existing) {
      board.removeObject(existing)
      elementsRef.current.delete(elemId)
    }

    const color = text.color ?? getDefaultCanvasElementColor()
    const fontSize =
      text.sizeScale !== undefined ? sizeScaleToPixels(text.sizeScale) : (text.fontSize ?? 14)

    const el = board.create('text', [x, y, text.value], {
      fontSize,
      strokeColor: color,
      color,
      anchorX: 'middle',
      anchorY: 'middle',
      fixed: false,
      highlight: true,
    })

    el.on('drag', () => {
      if (isSyncingRef.current) return
      isDraggingRef.current = true
      const textEl = el as unknown as { X: () => number; Y: () => number }
      onTextMovedRef.current?.(i, round1(textEl.X()), round1(textEl.Y()))
    })
    el.on('up', () => {
      isDraggingRef.current = false
    })
    elementsRef.current.set(elemId, el)
  }
}

type XY = { X: () => number; Y: () => number }

/** Compute one endpoint coord (user-space) for a perpendicular tick centered
 *  on a segment. `side = +1|-1` picks the two ends of the tick. Passed as JXG
 *  function-form coords so ticks track live during point drag. */
function segmentTickCoord(
  fromEl: XY,
  toEl: XY,
  tickIndex: number,
  totalTicks: number,
  side: 1 | -1,
  axis: 'x' | 'y',
  unitX: number,
  unitY: number,
): number {
  const fx = fromEl.X()
  const fy = fromEl.Y()
  const tx = toEl.X()
  const ty = toEl.Y()
  const dxPx = (tx - fx) * unitX
  const dyPx = (ty - fy) * unitY
  const lenPx = Math.hypot(dxPx, dyPx) || 1
  const uxPx = dxPx / lenPx
  const uyPx = dyPx / lenPx
  const perpXPx = -uyPx
  const perpYPx = uxPx
  const alongPx = (tickIndex - (totalTicks - 1) / 2) * EQ_TICK_SPACING_PX
  const halfLen = (EQ_TICK_LENGTH_PX / 2) * side
  if (axis === 'x') {
    const cx = (fx + tx) / 2 + (uxPx * alongPx) / unitX
    return cx + (perpXPx * halfLen) / unitX
  }
  const cy = (fy + ty) / 2 + (uyPx * alongPx) / unitY
  return cy + (perpYPx * halfLen) / unitY
}

/** Compute one endpoint coord (user-space) for a radial tick across an angle
 *  arc. Uses the same anti-parallel perpendicular fallback as
 *  computeAngleLabelPos so ticks don't collapse to the vertex. */
function angleTickCoord(
  centerEl: XY,
  ray1El: XY,
  ray2El: XY,
  radiusPx: number,
  tickIndex: number,
  totalTicks: number,
  side: 1 | -1,
  axis: 'x' | 'y',
  unitX: number,
  unitY: number,
): number {
  const cxU = centerEl.X()
  const cyU = centerEl.Y()
  const v1x = (ray1El.X() - cxU) * unitX
  const v1y = (ray1El.Y() - cyU) * unitY
  const v2x = (ray2El.X() - cxU) * unitX
  const v2y = (ray2El.Y() - cyU) * unitY
  const l1 = Math.hypot(v1x, v1y) || 1
  const l2 = Math.hypot(v2x, v2y) || 1
  let bx = v1x / l1 + v2x / l2
  let by = v1y / l1 + v2y / l2
  const bl = Math.hypot(bx, by)
  if (bl < 1e-6) {
    bx = -v1y / l1
    by = v1x / l1
  } else {
    bx /= bl
    by /= bl
  }
  const tanX = -by
  const tanY = bx
  // Cluster center: on the arc, which is drawn `radiusPx` screen pixels from
  // the vertex (see geometryAngleMarkers).
  const clusterCxU = cxU + (bx * radiusPx) / unitX
  const clusterCyU = cyU + (by * radiusPx) / unitY
  const alongPx = (tickIndex - (totalTicks - 1) / 2) * EQ_TICK_SPACING_PX
  const halfLen = (EQ_TICK_LENGTH_PX / 2) * side
  if (axis === 'x') {
    const centerXU = clusterCxU + (tanX * alongPx) / unitX
    return centerXU + (bx * halfLen) / unitX
  }
  const centerYU = clusterCyU + (tanY * alongPx) / unitY
  return centerYU + (by * halfLen) / unitY
}

function syncEqualSegments(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
) {
  const groups = geometry.elements.equalSegments || []
  const { unitX, unitY } = getBoardScale(board)
  groups.forEach((group, groupIndex) => {
    const tickCount = groupIndex + 1
    group.forEach((seg, segIndex) => {
      const fromEl = elementsRef.current.get(`point-${seg.from}`) as unknown as XY | undefined
      const toEl = elementsRef.current.get(`point-${seg.to}`) as unknown as XY | undefined
      if (!fromEl || !toEl) return
      for (let k = 0; k < tickCount; k++) {
        const elemId = `eqseg-${groupIndex}-${segIndex}-${k}`
        newIds.add(elemId)
        // Recreate every sync so structural changes (group order, tick count,
        // which segment maps to which slot) take effect. Point-drag movement
        // stays live between syncs because coords below are JXG functions
        // that recompute against the point elements.
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }
        const el = board.create(
          'segment',
          [
            [
              () => segmentTickCoord(fromEl, toEl, k, tickCount, 1, 'x', unitX, unitY),
              () => segmentTickCoord(fromEl, toEl, k, tickCount, 1, 'y', unitX, unitY),
            ],
            [
              () => segmentTickCoord(fromEl, toEl, k, tickCount, -1, 'x', unitX, unitY),
              () => segmentTickCoord(fromEl, toEl, k, tickCount, -1, 'y', unitX, unitY),
            ],
          ],
          {
            strokeColor: getDefaultCanvasElementColor(),
            strokeWidth: 1.875,
            fixed: true,
            visible: true,
            highlight: false,
          },
        )
        elementsRef.current.set(elemId, el)
      }
    })
  })
}

function syncEqualAngles(
  board: JXGBoard,
  geometry: GeometrySpecV1,
  newIds: Set<string>,
  elementsRef: React.MutableRefObject<Map<string, JXGElement>>,
) {
  const groups = geometry.elements.equalAngles || []
  const angles = geometry.elements.angles
  const { unitX, unitY } = getBoardScale(board)
  groups.forEach((group, groupIndex) => {
    const tickCount = groupIndex + 1
    group.forEach((angleIdx, memberIndex) => {
      const angle = angles[angleIdx]
      if (!angle) return
      const centerEl = elementsRef.current.get(`point-${angle.center}`) as unknown as XY | undefined
      const ray1El = elementsRef.current.get(`point-${angle.ray1}`) as unknown as XY | undefined
      const ray2El = elementsRef.current.get(`point-${angle.ray2}`) as unknown as XY | undefined
      if (!centerEl || !ray1El || !ray2El) return
      const radiusPx = angleMarkerRadiusPx(angle, unitX, unitY)
      for (let k = 0; k < tickCount; k++) {
        const elemId = `eqang-${groupIndex}-${memberIndex}-${k}`
        newIds.add(elemId)
        const existing = elementsRef.current.get(elemId)
        if (existing) {
          board.removeObject(existing)
          elementsRef.current.delete(elemId)
        }
        const el = board.create(
          'segment',
          [
            [
              () =>
                angleTickCoord(
                  centerEl,
                  ray1El,
                  ray2El,
                  radiusPx,
                  k,
                  tickCount,
                  1,
                  'x',
                  unitX,
                  unitY,
                ),
              () =>
                angleTickCoord(
                  centerEl,
                  ray1El,
                  ray2El,
                  radiusPx,
                  k,
                  tickCount,
                  1,
                  'y',
                  unitX,
                  unitY,
                ),
            ],
            [
              () =>
                angleTickCoord(
                  centerEl,
                  ray1El,
                  ray2El,
                  radiusPx,
                  k,
                  tickCount,
                  -1,
                  'x',
                  unitX,
                  unitY,
                ),
              () =>
                angleTickCoord(
                  centerEl,
                  ray1El,
                  ray2El,
                  radiusPx,
                  k,
                  tickCount,
                  -1,
                  'y',
                  unitX,
                  unitY,
                ),
            ],
          ],
          {
            strokeColor: angle.color || getDefaultAngleColor(),
            strokeWidth: 1.875,
            fixed: true,
            visible: true,
            highlight: false,
          },
        )
        elementsRef.current.set(elemId, el)
      }
    })
  })
}
