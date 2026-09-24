/**
 * Shared placement helpers for geometry angle labels.
 *
 * The admin editor and the shared renderer both position angle labels along
 * the bisector at one of three preset distances relative to the angle's arc
 * radius. Extracted here so the multipliers stay in a single place — drifting
 * between editor and renderer would cause label positions to jump when a
 * lesson is opened in one but rendered in the other.
 */

export type AngleLabelDistance = 'near' | 'mid' | 'far'

/**
 * Multipliers of the angle's `arcRadius` (in pixel units) used to place the
 * label along the interior bisector. `mid` sits ~one arc-radius outside the
 * arc; `near` hugs it; `far` pushes it a bit further out.
 */
export const ANGLE_LABEL_DISTANCE_MULTIPLIERS: Record<AngleLabelDistance, number> = {
  near: 1.3,
  mid: 2.0,
  far: 2.8,
}

const DISTANCE_ORDER: AngleLabelDistance[] = ['near', 'mid', 'far']

/** Board pixel-per-user-unit scale (as JSXGraph exposes it at runtime). */
export interface BoardPixelScale {
  unitX: number
  unitY: number
}

/**
 * Return the (x, y) user-space coordinates for the label of an angle at the
 * given ring distance. The math runs in pixel space (via `unitX`, `unitY`) so
 * the label sits the same visual distance from the vertex regardless of the
 * board's aspect ratio, then converts back to user coords.
 */
export function computeAngleLabelPos(
  scale: BoardPixelScale,
  cx: number,
  cy: number,
  r1x: number,
  r1y: number,
  r2x: number,
  r2y: number,
  arcRadiusPx: number,
  distance: AngleLabelDistance,
): { x: number; y: number } {
  const unitX = scale.unitX || 1
  const unitY = scale.unitY || 1
  const v1x = (r1x - cx) * unitX
  const v1y = (r1y - cy) * unitY
  const v2x = (r2x - cx) * unitX
  const v2y = (r2y - cy) * unitY
  const l1 = Math.hypot(v1x, v1y) || 1
  const l2 = Math.hypot(v2x, v2y) || 1
  let bx = v1x / l1 + v2x / l2
  let by = v1y / l1 + v2y / l2
  const bl = Math.hypot(bx, by)
  if (bl < 1e-6) {
    // Rays are anti-parallel (straight line). Fall back to a perpendicular
    // direction so the label doesn't collapse onto the vertex.
    bx = -v1y / l1
    by = v1x / l1
  } else {
    bx /= bl
    by /= bl
  }
  const distPx = arcRadiusPx * ANGLE_LABEL_DISTANCE_MULTIPLIERS[distance]
  return { x: cx + (bx * distPx) / unitX, y: cy + (by * distPx) / unitY }
}

/**
 * Reorder two ray endpoints so that JSXGraph's `angle` element draws the
 * minor (≤ 180°) angle at the vertex instead of the reflex one.
 *
 * JSXGraph sweeps `board.create('angle', [ray1, center, ray2])` counter-
 * clockwise from ray1 to ray2. When that CCW sweep exceeds 180° the reflex
 * angle is shown. The 2D cross product of the two centre→ray vectors tells us
 * the sweep direction: negative means ray2 is clockwise from ray1, so the
 * CCW sweep is > 180° and we swap.
 *
 * Ray order is irrelevant for the angle-label bisector (it uses the symmetric
 * v1̂ + v2̂), so callers can keep passing the original rays to
 * `computeAngleLabelPos`.
 */
export function orderRaysForMinorAngle<T extends { X: () => number; Y: () => number }>(
  center: T,
  ray1: T,
  ray2: T,
): [T, T] {
  const cross =
    (ray1.X() - center.X()) * (ray2.Y() - center.Y()) -
    (ray1.Y() - center.Y()) * (ray2.X() - center.X())
  return cross < 0 ? [ray2, ray1] : [ray1, ray2]
}

/**
 * Given the drag-drop position of an angle label, return the distance ring
 * whose target position is closest. All math done in pixel space.
 */
export function snapAngleLabelDistance(
  scale: BoardPixelScale,
  cx: number,
  cy: number,
  labelX: number,
  labelY: number,
  arcRadiusPx: number,
): AngleLabelDistance {
  const unitX = scale.unitX || 1
  const unitY = scale.unitY || 1
  const dx = (labelX - cx) * unitX
  const dy = (labelY - cy) * unitY
  const distPx = Math.hypot(dx, dy)
  let best: AngleLabelDistance = 'mid'
  let bestGap = Infinity
  for (const key of DISTANCE_ORDER) {
    const target = arcRadiusPx * ANGLE_LABEL_DISTANCE_MULTIPLIERS[key]
    const gap = Math.abs(distPx - target)
    if (gap < bestGap) {
      bestGap = gap
      best = key
    }
  }
  return best
}
