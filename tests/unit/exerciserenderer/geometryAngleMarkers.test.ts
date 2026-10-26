/**
 * @fileType unit-test
 * @domain graphics
 * @pattern geometry-angle-markers
 * @ai-summary Locks the pixel-space angle marker: the arc stays a circle on boards with unequal x/y scales, the non-reflex side is drawn, and the label sits on the bisector — inside the shaded area when it fits, outside otherwise.
 */

import { describe, expect, it } from 'vitest'
import {
  angleMarkerRadiusPx,
  computeAngleMarker,
  type AngleMarkerInput,
  type Vec,
} from '@/ui/shared/exerciserenderer/graphics/geometryAngleMarkers'

const base: AngleMarkerInput = {
  center: { x: 0, y: 0 },
  ray1: { x: 10, y: 0 },
  ray2: { x: 0, y: 10 },
  radiusPx: 30,
  unitX: 1,
  unitY: 1,
  square: false,
  labelHalfPx: 6,
}

const toPx = (p: Vec, input: AngleMarkerInput) => ({
  x: (p.x - input.center.x) * input.unitX,
  y: (p.y - input.center.y) * input.unitY,
})
const pxDist = (p: Vec, input: AngleMarkerInput) => Math.hypot(toPx(p, input).x, toPx(p, input).y)
const pxAngle = (p: Vec, input: AngleMarkerInput) =>
  (Math.atan2(toPx(p, input).y, toPx(p, input).x) * 180) / Math.PI

describe('computeAngleMarker', () => {
  it('keeps the arc a circle in pixels when the board stretches x and y differently', () => {
    const input = { ...base, unitX: 2.5, unitY: 0.8 }
    const marker = computeAngleMarker(input)!
    for (const p of marker.outline) expect(pxDist(p, input)).toBeCloseTo(30, 6)
  })

  it('measures the angle on screen, not in board units', () => {
    // 45° in board units, but y is stretched 2x on screen → atan(2) ≈ 63.4°.
    const input = { ...base, ray2: { x: 10, y: 10 }, unitY: 2 }
    const marker = computeAngleMarker(input)!
    const last = marker.outline[marker.outline.length - 1]
    expect(pxAngle(last, input)).toBeCloseTo(63.435, 2)
  })

  it('draws the non-reflex side regardless of ray order', () => {
    const forward = computeAngleMarker(base)!
    const reversed = computeAngleMarker({ ...base, ray1: base.ray2, ray2: base.ray1 })!
    const midAngle = (m: typeof forward) => pxAngle(m.outline[16], base)
    expect(midAngle(forward)).toBeCloseTo(45, 6)
    expect(midAngle(reversed)).toBeCloseTo(45, 6)
  })

  it('centres the label on the bisector inside a wide angle', () => {
    const marker = computeAngleMarker(base)!
    expect(pxAngle(marker.labelAt, base)).toBeCloseTo(45, 6)
    expect(pxDist(marker.labelAt, base)).toBeLessThan(30)
  })

  it('moves the label outside the arc when it cannot fit between narrow rays', () => {
    const input = { ...base, ray2: { x: 10, y: 1 } }
    const marker = computeAngleMarker(input)!
    expect(pxDist(marker.labelAt, input)).toBeGreaterThan(30)
  })

  it('honours an explicit outside position', () => {
    const marker = computeAngleMarker({ ...base, labelPosition: 'outside' })!
    expect(pxDist(marker.labelAt, base)).toBeGreaterThan(30)
  })

  it('draws a square marker with side r along each ray', () => {
    const marker = computeAngleMarker({ ...base, square: true })!
    expect(marker.outline).toHaveLength(3)
    expect(pxDist(marker.outline[0], base)).toBeCloseTo(30, 6)
    expect(pxDist(marker.outline[2], base)).toBeCloseTo(30, 6)
  })

  it('returns null for a degenerate (zero-sweep) angle', () => {
    expect(computeAngleMarker({ ...base, ray2: { x: 20, y: 0 } })).toBeNull()
  })
})

describe('angleMarkerRadiusPx', () => {
  it('scales the authored radius by the geometric mean of the board units', () => {
    expect(angleMarkerRadiusPx({ arcRadius: 50 } as never, 4, 1)).toBeCloseTo(100, 6)
  })

  it('falls back to 30 when the angle has no arcRadius', () => {
    expect(angleMarkerRadiusPx({} as never, 1, 1)).toBe(30)
  })
})
