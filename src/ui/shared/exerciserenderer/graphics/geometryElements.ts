/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GeometrySpecV1 } from '@/infra/contracts'
import {
  getDefaultAngleColor,
  getDefaultTextColor,
  sizeScaleToPixels,
} from '@/infra/contracts/graphics/textColors'
import { collectEdgeAngles, pickSafeCompassPosition } from '@/infra/utils/graphics/point-label'
import { angleMarkerRadiusPx, renderAngles } from './geometryAngleMarkers'

type PointSpec = GeometrySpecV1['elements']['points'][number]
type LineSpec = GeometrySpecV1['elements']['lines'][number]
type CircleSpec = GeometrySpecV1['elements']['circles'][number]
type AngleSpec = GeometrySpecV1['elements']['angles'][number]
type EqualSegmentGroup = NonNullable<GeometrySpecV1['elements']['equalSegments']>[number]
type EqualAngleGroup = NonNullable<GeometrySpecV1['elements']['equalAngles']>[number]

/** Tick styling for equality markers. Pixel-based so ticks look consistent
 *  across boards with different user-unit scales. */
const EQ_TICK_LENGTH_PX = 10.4
const EQ_TICK_SPACING_PX = 5

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

function renderPoints(
  board: JXG.Board,
  points: PointSpec[],
  spec: GeometrySpecV1,
): Map<string, any> {
  const pointMap = new Map<string, any>()
  for (const p of points) {
    const pointColor = p.color ?? getDefaultTextColor()
    const labelVisible = p.labelVisible !== false
    // Nudge off incident edges so the label doesn't render on top of lines or
    // polygon sides. Author's position is kept when it's already free.
    const safePosition = pickSafeCompassPosition(p.position, collectEdgeAngles(spec, p.name))
    const pt = board.create('point', [p.x, p.y], {
      name: p.name,
      fixed: true,
      visible: p.visible !== false,
      fillColor: pointColor,
      strokeColor: pointColor,
      // Fallback matches the authored default (2) so legacy data without a size
      // field renders at the new default instead of the pre-change 4.
      size: p.size ?? 2,
      withLabel: labelVisible,
      label: {
        offset: mapLabelOffset(safePosition),
        fontSize: p.fontSize ?? 15,
        cssStyle: "font-family: 'Times New Roman', Times, serif;",
        visible: labelVisible,
      },
    })
    pointMap.set(p.name, pt)
  }
  return pointMap
}

function renderLines(
  board: JXG.Board,
  lines: LineSpec[],
  pointMap: Map<string, any>,
  canvasHeight: number,
) {
  for (const line of lines) {
    const from = pointMap.get(line.from)
    const to = pointMap.get(line.to)
    if (!from || !to) continue

    const attrs: Record<string, unknown> = {
      strokeWidth: line.thickness ?? 2,
      dash: line.style === 'dashed' ? 2 : 0,
      straightFirst: false,
      straightLast: false,
      // Force visible so segments render even when parent points are
      // `visible: false` (a common pattern for angle-only questions where
      // only the arcs and lines should be shown, without vertex dots).
      // Without this JSXGraph propagates the parents' invisibility down.
      visible: true,
    }
    if (line.color) attrs.strokeColor = line.color

    board.create('segment', [from, to], attrs)

    if (line.label?.value) {
      const dx = to.X() - from.X()
      const dy = to.Y() - from.Y()
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const baseOffset = canvasHeight * 0.03
      // The perpendicular normal is (-dy/len, dx/len). Its Y component is dx/len,
      // which flips sign when from→to goes right-to-left (or top-to-bottom).
      // Multiply by sign(dx) so "above/below" refers to the screen Y axis
      // rather than the direction-relative perpendicular. Near-vertical lines
      // (|dx| ≈ 0) have no meaningful "above/below" — keep a stable side there.
      const userSign = line.label.position === 'b' ? -1 : 1
      const sign = Math.abs(dx) / len < 0.05 ? userSign : userSign * Math.sign(dx)
      const offsetDist = sign * baseOffset
      const midX = (from.X() + to.X()) / 2 + (-dy / len) * offsetDist
      const midY = (from.Y() + to.Y()) / 2 + (dx / len) * offsetDist
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI
      if (deg > 90) deg -= 180
      if (deg < -90) deg += 180
      board.create('text', [midX, midY, line.label.value], {
        fontSize: line.label.fontSize ?? 10,
        anchorX: 'middle',
        anchorY: 'middle',
        display: 'internal',
        rotate: deg,
        cssStyle: "font-family: 'Times New Roman', Times, serif;",
      })
    }
  }
}

function renderCircles(board: JXG.Board, circles: CircleSpec[], pointMap: Map<string, any>) {
  for (const c of circles) {
    const center = pointMap.get(c.center)
    if (!center) continue

    const attrs: Record<string, unknown> = {
      dash: c.style === 'dashed' ? 2 : 0,
      fillColor: 'none',
    }
    if (c.color) attrs.strokeColor = c.color

    if (c.through) {
      const through = pointMap.get(c.through)
      if (through) board.create('circle', [center, through], attrs)
    } else if (c.radius) {
      board.create('circle', [center, c.radius], attrs)
    }
  }
}

function getBoardScale(board: JXG.Board): { unitX: number; unitY: number } {
  const b = board as unknown as { unitX?: number; unitY?: number }
  return { unitX: b.unitX || 1, unitY: b.unitY || 1 }
}

function renderEqualSegments(
  board: JXG.Board,
  groups: EqualSegmentGroup[],
  pointMap: Map<string, any>,
) {
  const { unitX, unitY } = getBoardScale(board)
  groups.forEach((group, groupIndex) => {
    const tickCount = groupIndex + 1
    for (const seg of group) {
      const from = pointMap.get(seg.from)
      const to = pointMap.get(seg.to)
      if (!from || !to) continue
      const fx = from.X()
      const fy = from.Y()
      const tx = to.X()
      const ty = to.Y()
      // Work in pixel space so tick length/spacing stay visually consistent
      // regardless of the board's aspect ratio.
      const dxPx = (tx - fx) * unitX
      const dyPx = (ty - fy) * unitY
      const lenPx = Math.hypot(dxPx, dyPx) || 1
      const uxPx = dxPx / lenPx
      const uyPx = dyPx / lenPx
      const perpXPx = -uyPx
      const perpYPx = uxPx
      const midX = (fx + tx) / 2
      const midY = (fy + ty) / 2
      for (let k = 0; k < tickCount; k++) {
        const alongPx = (k - (tickCount - 1) / 2) * EQ_TICK_SPACING_PX
        const cx = midX + (uxPx * alongPx) / unitX
        const cy = midY + (uyPx * alongPx) / unitY
        const halfLen = EQ_TICK_LENGTH_PX / 2
        const e1x = cx + (perpXPx * halfLen) / unitX
        const e1y = cy + (perpYPx * halfLen) / unitY
        const e2x = cx - (perpXPx * halfLen) / unitX
        const e2y = cy - (perpYPx * halfLen) / unitY
        board.create(
          'segment',
          [
            [e1x, e1y],
            [e2x, e2y],
          ],
          {
            strokeColor: getDefaultTextColor(),
            strokeWidth: 1.875,
            fixed: true,
            visible: true,
            highlight: false,
          },
        )
      }
    }
  })
}

function renderEqualAngles(
  board: JXG.Board,
  groups: EqualAngleGroup[],
  angles: AngleSpec[],
  pointMap: Map<string, any>,
) {
  const { unitX, unitY } = getBoardScale(board)
  groups.forEach((group, groupIndex) => {
    const tickCount = groupIndex + 1
    for (const angleIdx of group) {
      const angle = angles[angleIdx]
      if (!angle) continue
      const center = pointMap.get(angle.center)
      const ray1 = pointMap.get(angle.ray1)
      const ray2 = pointMap.get(angle.ray2)
      if (!center || !ray1 || !ray2) continue
      const cxU = center.X()
      const cyU = center.Y()
      // Bisector direction in pixel space (mirrors computeAngleLabelPos).
      const v1x = (ray1.X() - cxU) * unitX
      const v1y = (ray1.Y() - cyU) * unitY
      const v2x = (ray2.X() - cxU) * unitX
      const v2y = (ray2.Y() - cyU) * unitY
      const l1 = Math.hypot(v1x, v1y) || 1
      const l2 = Math.hypot(v2x, v2y) || 1
      let bx = v1x / l1 + v2x / l2
      let by = v1y / l1 + v2y / l2
      const bl = Math.hypot(bx, by)
      if (bl < 1e-6) {
        // Anti-parallel rays: sum-of-unit-vectors degenerates to (0,0). Mirror
        // the perpendicular fallback used by computeAngleLabelPos so ticks
        // don't collapse to the vertex.
        bx = -v1y / l1
        by = v1x / l1
      } else {
        bx /= bl
        by /= bl
      }
      // Tangent to arc at bisector = perpendicular to radial direction.
      const tanX = -by
      const tanY = bx
      // Center of the tick cluster: on the arc along the bisector. The arc is
      // drawn in pixel space (see geometryAngleMarkers), so step the same
      // pixel radius here and map back to user coords.
      const radiusPx = angleMarkerRadiusPx(angle, unitX, unitY)
      const clusterCxU = cxU + (bx * radiusPx) / unitX
      const clusterCyU = cyU + (by * radiusPx) / unitY
      const halfLen = EQ_TICK_LENGTH_PX / 2
      for (let k = 0; k < tickCount; k++) {
        const alongPx = (k - (tickCount - 1) / 2) * EQ_TICK_SPACING_PX
        // Tick center sits on the arc, shifted tangentially so ticks line up
        // across the arc's midpoint area.
        const centerXU = clusterCxU + (tanX * alongPx) / unitX
        const centerYU = clusterCyU + (tanY * alongPx) / unitY
        // Tick extends radially (perpendicular to arc).
        const e1x = centerXU + (bx * halfLen) / unitX
        const e1y = centerYU + (by * halfLen) / unitY
        const e2x = centerXU - (bx * halfLen) / unitX
        const e2y = centerYU - (by * halfLen) / unitY
        board.create(
          'segment',
          [
            [e1x, e1y],
            [e2x, e2y],
          ],
          {
            strokeColor: angle.color || getDefaultAngleColor(),
            strokeWidth: 1.875,
            fixed: true,
            visible: true,
            highlight: false,
          },
        )
      }
    }
  })
}

/**
 * Render all geometry elements from a GeometrySpecV1 onto a JSXGraph board.
 */
export function renderGeometrySpec(board: JXG.Board, spec: GeometrySpecV1): void {
  const pointMap = renderPoints(board, spec.elements.points, spec)
  renderLines(board, spec.elements.lines, pointMap, spec.canvas.height)
  renderCircles(board, spec.elements.circles, pointMap)
  renderAngles(board, spec.elements.angles, pointMap)

  if (spec.elements.equalSegments) {
    renderEqualSegments(board, spec.elements.equalSegments, pointMap)
  }
  if (spec.elements.equalAngles) {
    renderEqualAngles(board, spec.elements.equalAngles, spec.elements.angles, pointMap)
  }

  if (spec.elements.vectors) {
    for (const v of spec.elements.vectors) {
      const from = pointMap.get(v.from)
      const to = pointMap.get(v.to)
      if (!from || !to) continue
      const attrs: Record<string, unknown> = {
        strokeWidth: v.thickness ?? 2,
        dash: v.style === 'dashed' ? 2 : 0,
      }
      if (v.color) attrs.strokeColor = v.color
      board.create('arrow', [from, to], attrs)
    }
  }

  if (spec.elements.areas) {
    for (const area of spec.elements.areas) {
      const pts = area.polygon.map((name) => pointMap.get(name)).filter(Boolean)
      if (pts.length >= 3) {
        const attrs: Record<string, unknown> = {
          fillOpacity: 0.3,
          borders: { strokeWidth: 0 },
        }
        if (area.color) attrs.fillColor = area.color
        board.create('polygon', pts, attrs)
      }
    }
  }

  if (spec.elements.rectangles) {
    for (const rect of spec.elements.rectangles) {
      const pts = rect.points.map((name) => pointMap.get(name)).filter(Boolean)
      if (pts.length === 4) {
        const attrs: Record<string, unknown> = {
          borders: {
            strokeWidth: rect.thickness ?? 2,
            dash: rect.style === 'dashed' ? 2 : 0,
          },
        }
        if (rect.color) {
          attrs.borders = { ...(attrs.borders as object), strokeColor: rect.color }
        }
        if (rect.fill) {
          attrs.fillColor = rect.fill
          attrs.fillOpacity = 0.3
        }
        board.create('polygon', pts, attrs)
      }
    }
  }

  if (spec.elements.triangles) {
    for (const tri of spec.elements.triangles) {
      const pts = tri.points.map((name) => pointMap.get(name)).filter(Boolean)
      if (pts.length === 3) {
        const attrs: Record<string, unknown> = {
          borders: {
            strokeWidth: tri.thickness ?? 2,
            dash: tri.style === 'dashed' ? 2 : 0,
          },
        }
        if (tri.color) {
          attrs.borders = { ...(attrs.borders as object), strokeColor: tri.color }
        }
        if (tri.fill) {
          attrs.fillColor = tri.fill
          attrs.fillOpacity = 0.3
        }
        board.create('polygon', pts, attrs)
      }
    }
  }

  if (spec.elements.texts) {
    for (const text of spec.elements.texts) {
      let x = text.place?.x ?? 0
      let y = text.place?.y ?? 0

      if (text.on?.from && text.on?.to) {
        const from = pointMap.get(text.on.from)
        const to = pointMap.get(text.on.to)
        if (from && to) {
          x = (from.X() + to.X()) / 2
          y = (from.Y() + to.Y()) / 2
        }
      }

      const color = text.color ?? getDefaultTextColor()
      board.create('text', [x, y, text.value], {
        fontSize:
          text.sizeScale !== undefined ? sizeScaleToPixels(text.sizeScale) : (text.fontSize ?? 14),
        strokeColor: color,
        color,
        anchorX: 'middle',
        anchorY: 'middle',
      })
    }
  }
}
