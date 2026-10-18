/**
 * Analytic placement helpers for geometry point labels.
 *
 * Point labels snap to one of 8 compass directions around the dot. The author
 * picks a direction (`position` on the point), but when that direction lands
 * directly on top of an incident edge the label visually overlaps the sketch.
 * `pickSafeCompassPosition` nudges the label to the nearest free octant when
 * — and only when — the author's choice would collide. Author data stays
 * untouched; the adjustment is render-time only.
 */

import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

export type CompassPos = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l'

/** Compass → user-coord angle (deg). Mirrors `angleToLabelPosition` in the
 *  canvas, where +y is up and 0° is right. */
const COMPASS_ANGLES: Record<CompassPos, number> = {
  r: 0,
  tr: 45,
  t: 90,
  tl: 135,
  l: 180,
  bl: 225,
  b: 270,
  br: 315,
}

const COMPASS_ORDER: CompassPos[] = ['r', 'tr', 't', 'tl', 'l', 'bl', 'b', 'br']

/** Half-width of the forbidden zone around each incident edge, in degrees.
 *  22.5° on each side = full octant (45°) centred on the edge direction. */
const COLLIDE_HALF_WIDTH_DEG = 22.5

const normalize = (deg: number) => ((deg % 360) + 360) % 360

/**
 * Collect the directions of every sketch element incident to `pointName`, as
 * angles in degrees in user coord space (0° = right, +y = up — matching the
 * label compass).
 */
export function collectEdgeAngles(spec: GeometrySpecV1, pointName: string): number[] {
  const points = new Map(spec.elements.points.map((p) => [p.name, p]))
  const self = points.get(pointName)
  if (!self) return []

  const angles: number[] = []
  const addEdgeTo = (otherName: string) => {
    if (otherName === pointName) return
    const other = points.get(otherName)
    if (!other) return
    const dx = other.x - self.x
    const dy = other.y - self.y
    if (dx === 0 && dy === 0) return
    angles.push(normalize((Math.atan2(dy, dx) * 180) / Math.PI))
  }

  for (const line of spec.elements.lines) {
    if (line.from === pointName) addEdgeTo(line.to)
    else if (line.to === pointName) addEdgeTo(line.from)
  }
  for (const vec of spec.elements.vectors ?? []) {
    if (vec.from === pointName) addEdgeTo(vec.to)
    else if (vec.to === pointName) addEdgeTo(vec.from)
  }

  const polygons: string[][] = [
    ...(spec.elements.triangles ?? []).map((t) => t.points),
    ...(spec.elements.rectangles ?? []).map((r) => r.points),
    ...(spec.elements.areas ?? []).map((a) => a.polygon),
  ]
  for (const polyPts of polygons) {
    const idx = polyPts.indexOf(pointName)
    if (idx === -1) continue
    addEdgeTo(polyPts[(idx - 1 + polyPts.length) % polyPts.length])
    addEdgeTo(polyPts[(idx + 1) % polyPts.length])
  }

  return angles
}

/**
 * Return a compass direction for the label that stays clear of every incident
 * edge. If the author's `position` is already clear we return it unchanged;
 * otherwise we walk outward (±1 octant, ±2, ...) looking for the nearest free
 * slot. When every slot is blocked (very obtuse star shapes) we return the
 * author's original choice unchanged — the correct degenerate behaviour.
 */
export function pickSafeCompassPosition(
  authored: string | undefined,
  edgeAngles: number[],
): CompassPos {
  const start = (authored && authored in COMPASS_ANGLES ? authored : 'r') as CompassPos
  if (edgeAngles.length === 0) return start

  const collides = (compass: CompassPos) => {
    const base = COMPASS_ANGLES[compass]
    for (const edgeDeg of edgeAngles) {
      let diff = Math.abs(normalize(base - edgeDeg))
      if (diff > 180) diff = 360 - diff
      if (diff < COLLIDE_HALF_WIDTH_DEG) return true
    }
    return false
  }

  if (!collides(start)) return start

  const startIdx = COMPASS_ORDER.indexOf(start)
  for (let step = 1; step <= 4; step++) {
    const plus = COMPASS_ORDER[(startIdx + step) % 8]
    if (!collides(plus)) return plus
    const minus = COMPASS_ORDER[(startIdx - step + 8) % 8]
    if (!collides(minus)) return minus
  }
  return start
}
