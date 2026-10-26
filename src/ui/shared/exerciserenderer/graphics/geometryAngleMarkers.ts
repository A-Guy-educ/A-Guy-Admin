/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GeometrySpecV1 } from '@/infra/contracts'
import {
  getAdminCanvasBackground,
  getDefaultAngleColor,
  getDefaultCanvasElementColor,
} from '@/infra/contracts/graphics/textColors'

type AngleSpec = GeometrySpecV1['elements']['angles'][number]

export interface Vec {
  x: number
  y: number
}

export interface AngleMarkerInput {
  center: Vec
  ray1: Vec
  ray2: Vec
  /** Marker size in screen pixels (arc radius / square side). */
  radiusPx: number
  /** Board pixels per user unit on each axis — they differ whenever the
   *  board's aspect ratio doesn't match its bounding box. */
  unitX: number
  unitY: number
  square: boolean
  /** Approximate half-extent of the label box in pixels; 0 when unlabeled. */
  labelHalfPx: number
  labelPosition?: 'inside' | 'outside'
}

export interface AngleMarker {
  /** Stroked part of the marker (the arc, or the two outer square sides). */
  outline: Vec[]
  /** Closed fill region, starting and ending at the vertex. */
  fill: Vec[]
  /** Label anchor, on the angle bisector. */
  labelAt: Vec
}

const ARC_SAMPLES = 32
// Renderer fallback stays at 30 so legacy angles saved without an explicit
// arcRadius don't grow. Author-time default is 50 (set in AnglesPanel).
const DEFAULT_ARC_RADIUS = 30
const DEFAULT_LABEL_FONT_SIZE = 10
const LABEL_GAP_PX = 2
/** Furthest an `inside` label's centre may sit, as a fraction of the marker reach. */
const INSIDE_MAX_REACH = 0.7
// JSXGraph layers: lines sit on 7, text on 9. The marker stroke goes above the
// lines so a side that starts at the vertex never cuts through the arc, and
// the label goes above everything.
export const ANGLE_FILL_LAYER = 3
export const ANGLE_OUTLINE_LAYER = 8
export const ANGLE_LABEL_LAYER = 10

/**
 * Computes an angle marker in screen-pixel space and maps it back to board
 * coordinates. JSXGraph's own `angle` element takes its radius in user units,
 * so on a board whose x and y scales differ the arc stretches into an
 * ellipse. Working in pixels keeps the arc a true circle and measures the
 * angle the reader actually sees. Mirrors A-Guy-Web's geometryAngleMarkers so
 * the editor preview matches the student view.
 *
 * Always draws the non-reflex side: when the sweep from ray1 to ray2 exceeds
 * 180° the marker starts from ray2 instead.
 */
export function computeAngleMarker(input: AngleMarkerInput): AngleMarker | null {
  const { center, ray1, ray2, radiusPx: r, unitX, unitY, square, labelHalfPx } = input
  const a1 = Math.atan2((ray1.y - center.y) * unitY, (ray1.x - center.x) * unitX)
  const a2 = Math.atan2((ray2.y - center.y) * unitY, (ray2.x - center.x) * unitX)
  if (!Number.isFinite(a1) || !Number.isFinite(a2)) return null

  const ccw = (((a2 - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const start = ccw > Math.PI ? a2 : a1
  const sweep = ccw > Math.PI ? 2 * Math.PI - ccw : ccw
  if (sweep === 0) return null

  const toBoard = (angle: number, distPx: number): Vec => ({
    x: center.x + (distPx * Math.cos(angle)) / unitX,
    y: center.y + (distPx * Math.sin(angle)) / unitY,
  })
  const mid = start + sweep / 2
  const halfSin = Math.sin(sweep / 2)

  let outline: Vec[]
  // Distance from the vertex to the far edge of the marker along the bisector.
  let reachPx: number
  if (square) {
    // Parallelogram with side r along each ray — same shape JSXGraph draws.
    const p1 = toBoard(start, r)
    const p3 = toBoard(start + sweep, r)
    const p2 = { x: p1.x + p3.x - center.x, y: p1.y + p3.y - center.y }
    outline = [p1, p2, p3]
    reachPx = 2 * r * Math.cos(sweep / 2)
  } else {
    outline = Array.from({ length: ARC_SAMPLES + 1 }, (_, i) =>
      toBoard(start + (sweep * i) / ARC_SAMPLES, r),
    )
    reachPx = r
  }

  // `outside`: just past the marker on the bisector. `inside` (the default):
  // within the shaded region — at its centroid, pushed out along the bisector
  // as far as needed to clear the rays, but never past INSIDE_MAX_REACH of the
  // marker so the label's centre stays on the coloured area even when the
  // label is bigger than the sector.
  const outsidePx = reachPx + labelHalfPx + LABEL_GAP_PX
  const centroidPx = square ? reachPx / 2 : (4 * r * halfSin) / (3 * sweep)
  const clearRaysPx = halfSin > 0 ? labelHalfPx / halfSin : Infinity
  const insidePx = Math.min(Math.max(centroidPx, clearRaysPx), reachPx * INSIDE_MAX_REACH)
  const labelDistPx = input.labelPosition === 'outside' ? outsidePx : insidePx

  return {
    outline,
    fill: [center, ...outline, center],
    labelAt: toBoard(mid, labelDistPx),
  }
}

/** Rough half-extent of a short label (angle letters / degree values). */
function estimateLabelHalfPx(value: string, fontSize: number): number {
  return Math.max(fontSize * 0.55, value.length * fontSize * 0.3)
}

/**
 * Marker size in pixels for an authored angle. `arcRadius` was authored in
 * user units on boards that were roughly 1 unit ≈ 1px; the geometric mean
 * keeps the marker the size it was.
 */
export function angleMarkerRadiusPx(angle: AngleSpec, unitX: number, unitY: number): number {
  return (angle.arcRadius || DEFAULT_ARC_RADIUS) * Math.sqrt(unitX * unitY)
}

export function angleLabelFontSize(angle: AngleSpec): number {
  return angle.label?.fontSize || DEFAULT_LABEL_FONT_SIZE
}

/** Builds the marker for an authored angle from its live point positions. */
export function computeSpecAngleMarker(
  angle: AngleSpec,
  center: Vec,
  ray1: Vec,
  ray2: Vec,
  unitX: number,
  unitY: number,
): AngleMarker | null {
  const label = angle.label?.value
  return computeAngleMarker({
    center,
    ray1,
    ray2,
    radiusPx: angleMarkerRadiusPx(angle, unitX, unitY),
    unitX,
    unitY,
    square: angle.style === 'square',
    labelHalfPx: label ? estimateLabelHalfPx(label, angleLabelFontSize(angle)) : 0,
    labelPosition: angle.label?.position,
  })
}

/** Labels use the canvas foreground (not the marker colour) — the hardcoded
 *  value, since the admin theme's --foreground is white in dark mode while the
 *  board stays white. */
export function angleLabelColor(): string {
  return getDefaultCanvasElementColor()
}

/** Bold Times label with a canvas-coloured halo that masks any side passing
 *  under it, so it reads as sitting on top of the lines. */
export function angleLabelCssStyle(): string {
  const halo = getAdminCanvasBackground()
  return `font-family: 'Times New Roman', Times, serif; font-weight: bold; text-shadow: 0 0 2px ${halo}, 0 0 3px ${halo}, 0 0 4px ${halo};`
}

export function angleFillAttrs(color: string): Record<string, unknown> {
  return { strokeWidth: 0, fillColor: color, fillOpacity: 0.15, layer: ANGLE_FILL_LAYER }
}

export function angleOutlineAttrs(color: string): Record<string, unknown> {
  return { strokeColor: color, strokeWidth: 2, fillColor: 'none', layer: ANGLE_OUTLINE_LAYER }
}

function curve(board: JXG.Board, pts: Vec[], attrs: Record<string, unknown>) {
  board.create('curve', [pts.map((p) => p.x), pts.map((p) => p.y)], {
    fixed: true,
    highlight: false,
    // Parent points may be `visible: false` when the block wants only
    // arcs/lines visible; the marker must still show.
    visible: true,
    ...attrs,
  } as any)
}

export function renderAngles(
  board: JXG.Board,
  angles: AngleSpec[],
  pointMap: Map<string, any>,
): void {
  const b = board as unknown as { unitX?: number; unitY?: number }
  const unitX = b.unitX || 1
  const unitY = b.unitY || 1
  for (const a of angles) {
    const center = pointMap.get(a.center)
    const ray1 = pointMap.get(a.ray1)
    const ray2 = pointMap.get(a.ray2)
    if (!center || !ray1 || !ray2) continue

    const marker = computeSpecAngleMarker(
      a,
      { x: center.X(), y: center.Y() },
      { x: ray1.X(), y: ray1.Y() },
      { x: ray2.X(), y: ray2.Y() },
      unitX,
      unitY,
    )
    if (!marker) continue

    const color = a.color || getDefaultAngleColor()
    curve(board, marker.fill, angleFillAttrs(color))
    curve(board, marker.outline, angleOutlineAttrs(color))

    if (a.label?.value) {
      board.create('text', [marker.labelAt.x, marker.labelAt.y, a.label.value], {
        fontSize: angleLabelFontSize(a),
        anchorX: 'middle',
        anchorY: 'middle',
        fixed: true,
        highlight: false,
        visible: true,
        layer: ANGLE_LABEL_LAYER,
        strokeColor: angleLabelColor(),
        cssStyle: angleLabelCssStyle(),
      })
    }
  }
}
