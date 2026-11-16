/**
 * Compass → label placement for point labels (geometry + axis, JSXGraph + SVG).
 *
 * JSXGraph text defaults to anchorX 'left' / anchorY 'middle', so a bare pixel
 * offset places the label's left edge — `b`/`t` labels drift right and `l`
 * labels overlap the dot. We anchor the side of the label that faces the dot
 * instead, so every direction keeps the same gap.
 */

export type PointLabelPlacement = {
  offset: [number, number]
  anchorX: 'left' | 'middle' | 'right'
  anchorY: 'top' | 'middle' | 'bottom'
}

type PlacementOptions = {
  /** Gap between the dot centre and the nearest label edge, in px. */
  gapPx?: number
  /** Used when `pos` is missing or not a compass direction. */
  fallback?: string
}

const COMPASS = new Set(['t', 'tr', 'r', 'br', 'b', 'bl', 'l', 'tl', 'm', 'middle'])

export function pointLabelPlacement(
  pos?: string,
  { gapPx = 11, fallback = 'r' }: PlacementOptions = {},
): PointLabelPlacement {
  const compass = pos && COMPASS.has(pos) ? pos : fallback
  if (compass === 'm' || compass === 'middle') {
    return { offset: [0, 0], anchorX: 'middle', anchorY: 'middle' }
  }
  const sx = compass.includes('l') ? -1 : compass.includes('r') ? 1 : 0
  const sy = compass.includes('t') ? 1 : compass.includes('b') ? -1 : 0
  // Diagonals put a label corner on the ring, so each axis gets gap/√2.
  const dist = sx !== 0 && sy !== 0 ? Math.round(gapPx / Math.SQRT2) : gapPx
  return {
    offset: [sx * dist, sy * dist],
    anchorX: sx < 0 ? 'right' : sx > 0 ? 'left' : 'middle',
    anchorY: sy > 0 ? 'bottom' : sy < 0 ? 'top' : 'middle',
  }
}

const SVG_TEXT_ANCHOR = { left: 'start', middle: 'middle', right: 'end' } as const
const SVG_BASELINE = { top: 'hanging', middle: 'central', bottom: 'auto' } as const

/** SVG equivalent of a placement: y is flipped (SVG +y points down). */
export function svgPointLabelAttrs(placement: PointLabelPlacement) {
  return {
    dx: placement.offset[0],
    dy: -placement.offset[1],
    textAnchor: SVG_TEXT_ANCHOR[placement.anchorX],
    dominantBaseline: SVG_BASELINE[placement.anchorY],
  }
}
