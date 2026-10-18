/**
 * Shared placement helpers for geometry angle labels.
 *
 * The admin editor and the shared renderer both position angle labels along
 * the bisector. New authored content picks between two spots — inside the
 * angle wedge or just outside the arc — via the `position` field. Legacy
 * content may have a `distance` ring (near/mid/far) set; we keep honoring it
 * so historical lessons render identically.
 */

export type AngleLabelPosition = 'inside' | 'outside'

/** Legacy ring presets — kept so content authored before the inside/outside
 *  simplification keeps its original visual placement. New authoring never
 *  writes `distance` and always goes through the position-based path. */
export type AngleLabelDistance = 'near' | 'mid' | 'far'

/**
 * Multipliers of the angle's `arcRadius` along the interior bisector.
 *   - `inside` sits inside the arc wedge, roughly between the vertex and arc
 *   - `outside` sits just past the arc on the same bisector ray
 */
export const ANGLE_LABEL_POSITION_MULTIPLIERS: Record<AngleLabelPosition, number> = {
  inside: 0.65,
  outside: 1.5,
}

/** Legacy ring multipliers — only used when a label still carries a `distance`
 *  value from the old near/mid/far picker. */
export const ANGLE_LABEL_DISTANCE_MULTIPLIERS: Record<AngleLabelDistance, number> = {
  near: 1.3,
  mid: 2.0,
  far: 2.8,
}

/** Board pixel-per-user-unit scale (as JSXGraph exposes it at runtime). */
export interface BoardPixelScale {
  unitX: number
  unitY: number
}

/**
 * Resolve the arc-radius multiplier for a label spec. Legacy data wins when
 * `distance` is present so historical lessons keep their visual positioning;
 * new data (no distance) uses the position-based multiplier.
 */
export function resolveAngleLabelMultiplier(spec: {
  position?: AngleLabelPosition
  distance?: AngleLabelDistance
}): number {
  if (spec.distance) return ANGLE_LABEL_DISTANCE_MULTIPLIERS[spec.distance]
  return ANGLE_LABEL_POSITION_MULTIPLIERS[spec.position ?? 'inside']
}

/**
 * Return the (x, y) user-space coordinates for the label of an angle. The math
 * runs in pixel space (via `unitX`, `unitY`) so the label sits the same visual
 * distance from the vertex regardless of the board's aspect ratio, then
 * converts back to user coords.
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
  spec: { position?: AngleLabelPosition; distance?: AngleLabelDistance },
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
  const distPx = arcRadiusPx * resolveAngleLabelMultiplier(spec)
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
 * Given the drag-drop position of an angle label, return the position bucket
 * (`inside` vs `outside`) whose target is closest. All math done in pixel
 * space. The midpoint between the two multipliers acts as the snap boundary,
 * so dropping within the arc snaps to `inside` and dropping past it snaps to
 * `outside`.
 */
export function snapAngleLabelPosition(
  scale: BoardPixelScale,
  cx: number,
  cy: number,
  labelX: number,
  labelY: number,
  arcRadiusPx: number,
): AngleLabelPosition {
  const unitX = scale.unitX || 1
  const unitY = scale.unitY || 1
  const dx = (labelX - cx) * unitX
  const dy = (labelY - cy) * unitY
  const distPx = Math.hypot(dx, dy)
  const insideTarget = arcRadiusPx * ANGLE_LABEL_POSITION_MULTIPLIERS.inside
  const outsideTarget = arcRadiusPx * ANGLE_LABEL_POSITION_MULTIPLIERS.outside
  return Math.abs(distPx - insideTarget) <= Math.abs(distPx - outsideTarget) ? 'inside' : 'outside'
}
