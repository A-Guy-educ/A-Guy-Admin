/**
 * @fileType utility
 * @domain graphics
 * @pattern geometry-content-bounds
 * @ai-summary Compute the extent of a geometry sketch's points + circles and
 *             a padded JSXGraph bounding box that fits them ("fit to content").
 */

import type { BoundingBox } from './bounding-box-fit'

export interface ContentPoint {
  name: string
  x: number
  y: number
}

export interface ContentCircle {
  center: string
  radius?: number
  through?: string
}

export interface ContentExtent {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** Padding added on each side, as a fraction of the content range. */
export const CONTENT_PADDING_FRACTION = 0.1

/** Flat padding (in user units) when an axis has no spread at all. */
export const CONTENT_FLAT_PADDING = 20

function usablePoints(points: readonly ContentPoint[]): ContentPoint[] {
  return points.filter((p) => p.name && Number.isFinite(p.x) && Number.isFinite(p.y))
}

function circleRadius(
  circle: ContentCircle,
  center: ContentPoint,
  pointByName: Map<string, ContentPoint>,
): number | undefined {
  if (typeof circle.radius === 'number' && circle.radius > 0) return circle.radius
  if (!circle.through) return undefined
  const t = pointByName.get(circle.through)
  return t ? Math.hypot(t.x - center.x, t.y - center.y) : undefined
}

/**
 * Raw extent of the points plus every circle whose center resolves to one of
 * them (grown by the numeric radius or the distance to the `through` point).
 * Circles whose center isn't in `points` are skipped. Returns null when there
 * are no usable points.
 */
export function computeContentExtent(
  points: readonly ContentPoint[],
  circles: readonly ContentCircle[] = [],
): ContentExtent | null {
  const usable = usablePoints(points)
  if (usable.length === 0) return null
  const pointByName = new Map(usable.map((p) => [p.name, p]))

  const extent = usable.reduce<ContentExtent>(
    (acc, p) => ({
      xMin: Math.min(acc.xMin, p.x),
      xMax: Math.max(acc.xMax, p.x),
      yMin: Math.min(acc.yMin, p.y),
      yMax: Math.max(acc.yMax, p.y),
    }),
    { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity },
  )

  return circles.reduce<ContentExtent>((acc, c) => {
    const center = pointByName.get(c.center)
    if (!center) return acc
    const r = circleRadius(c, center, pointByName)
    if (!r || !Number.isFinite(r) || r <= 0) return acc
    return {
      xMin: Math.min(acc.xMin, center.x - r),
      xMax: Math.max(acc.xMax, center.x + r),
      yMin: Math.min(acc.yMin, center.y - r),
      yMax: Math.max(acc.yMax, center.y + r),
    }
  }, extent)
}

/**
 * Bounding box `[xMin, yMax, xMax, yMin]` that fits the content with 10%
 * padding per side (flat padding when an axis has no spread). Null when there
 * are no usable points.
 */
export function computeContentBoundingBox(
  points: readonly ContentPoint[],
  circles: readonly ContentCircle[] = [],
): BoundingBox | null {
  const extent = computeContentExtent(points, circles)
  if (!extent) return null
  const xRange = extent.xMax - extent.xMin
  const yRange = extent.yMax - extent.yMin
  const padX = xRange > 0 ? xRange * CONTENT_PADDING_FRACTION : CONTENT_FLAT_PADDING
  const padY = yRange > 0 ? yRange * CONTENT_PADDING_FRACTION : CONTENT_FLAT_PADDING
  return [extent.xMin - padX, extent.yMax + padY, extent.xMax + padX, extent.yMin - padY]
}

/** True when any point or resolvable circle pokes outside the box. */
export function isContentOutsideBox(
  box: BoundingBox,
  points: readonly ContentPoint[],
  circles: readonly ContentCircle[] = [],
): boolean {
  const extent = computeContentExtent(points, circles)
  if (!extent) return false
  const [xMin, yMax, xMax, yMin] = box
  return extent.xMin < xMin || extent.xMax > xMax || extent.yMin < yMin || extent.yMax > yMax
}
