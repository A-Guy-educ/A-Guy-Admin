import { describe, expect, it } from 'vitest'

import { SKETCH_HEIGHT_PX } from '@/infra/utils/graphics/board-sizing'
import type { BoundingBox } from '@/infra/utils/graphics/bounding-box-fit'
import {
  applyCanvasWidth,
  boxAspectRatio,
  deriveCanvasWidth,
  fitCanvasToContent,
  formatAspectRatio,
  type GeometryCanvasSize,
  isExtremeRatio,
  normalizeGeometryCanvas,
} from '@/infra/utils/graphics/geometry-canvas-size'

// Two side-by-side triangles from a real lesson: ≈2.68:1 box stored on a 400×400 canvas.
const WIDE_BOX: BoundingBox = [25.36, 241.98, 491.33, 68.02]
const wideCanvas = { width: 400, height: 400, boundingBox: WIDE_BOX }

function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    outer[0] <= inner[0] + 1e-9 &&
    outer[1] >= inner[1] - 1e-9 &&
    outer[2] >= inner[2] - 1e-9 &&
    outer[3] <= inner[3] + 1e-9
  )
}

describe('deriveCanvasWidth (on-load width)', () => {
  it('derives the width from the box ratio and ignores the stored width', () => {
    const ratio = (491.33 - 25.36) / (241.98 - 68.02)
    expect(deriveCanvasWidth(wideCanvas)).toBe(Math.round(SKETCH_HEIGHT_PX * ratio))
    expect(deriveCanvasWidth({ ...wideCanvas, width: 123 })).toBe(deriveCanvasWidth(wideCanvas))
  })

  it('uses the [0, height, width, 0] fallback when there is no box', () => {
    expect(deriveCanvasWidth({ width: 600, height: 400 })).toBe(495)
  })

  it('keeps the stored width for a degenerate box', () => {
    expect(deriveCanvasWidth({ width: 400, height: 400, boundingBox: [0, 5, 0, 5] })).toBe(400)
  })
})

describe('applyCanvasWidth (width → box)', () => {
  it('grows y (centered) when the target is narrower than the box', () => {
    const next = applyCanvasWidth(wideCanvas, SKETCH_HEIGHT_PX) // square
    const [xMin, yMax, xMax, yMin] = next.boundingBox!
    expect(xMin).toBeCloseTo(WIDE_BOX[0])
    expect(xMax).toBeCloseTo(WIDE_BOX[2])
    expect(yMax - yMin).toBeCloseTo(xMax - xMin)
    expect((yMax + yMin) / 2).toBeCloseTo((WIDE_BOX[1] + WIDE_BOX[3]) / 2)
    expect(contains(next.boundingBox!, WIDE_BOX)).toBe(true)
    expect(next).toMatchObject({ width: SKETCH_HEIGHT_PX, height: SKETCH_HEIGHT_PX })
  })

  it('grows x (centered) when the target is wider than the box', () => {
    const square: BoundingBox = [0, 10, 10, 0]
    const next = applyCanvasWidth({ width: 400, height: 400, boundingBox: square }, 660)
    expect(next.boundingBox).toEqual([-5, 10, 15, 0])
    expect(next).toMatchObject({ width: 660, height: SKETCH_HEIGHT_PX })
  })

  it('materializes the fallback box before growing it', () => {
    const next = applyCanvasWidth({ width: 400, height: 400 }, 660)
    expect(next.boundingBox).toEqual([-200, 400, 600, 0])
  })

  it('lands on the requested ratio', () => {
    const next = applyCanvasWidth(wideCanvas, 500)
    expect(boxAspectRatio(next.boundingBox!)).toBeCloseTo(500 / SKETCH_HEIGHT_PX)
  })
})

describe('normalizeGeometryCanvas (write the real size on save)', () => {
  it('writes height 330 and the derived width without touching the box', () => {
    const next = normalizeGeometryCanvas({ ...wideCanvas, grid: true })
    expect(next.boundingBox).toEqual(WIDE_BOX)
    expect(next).toMatchObject({
      height: SKETCH_HEIGHT_PX,
      width: deriveCanvasWidth(wideCanvas),
      grid: true,
    })
  })

  it('materializes the fallback box so the view does not move', () => {
    const next = normalizeGeometryCanvas({ width: 600, height: 400 })
    expect(next).toEqual({ width: 495, height: SKETCH_HEIGHT_PX, boundingBox: [0, 400, 600, 0] })
  })

  it('returns the same object when already consistent', () => {
    const once = normalizeGeometryCanvas(wideCanvas)
    expect(normalizeGeometryCanvas(once)).toBe(once)
  })

  it('leaves a degenerate canvas untouched', () => {
    const degenerate = { width: 400, height: 400, boundingBox: [0, 5, 0, 5] as BoundingBox }
    expect(normalizeGeometryCanvas(degenerate)).toBe(degenerate)
  })
})

describe('fitCanvasToContent', () => {
  const points = [
    { name: 'A', x: 0, y: 0 },
    { name: 'B', x: 200, y: 0 },
    { name: 'C', x: 100, y: 100 },
  ]

  it('refits the box with 10% padding and derives the width', () => {
    const next = fitCanvasToContent<GeometryCanvasSize>({ width: 400, height: 400 }, points)
    expect(next.boundingBox).toEqual([-20, 110, 220, -10])
    expect(next).toMatchObject({ width: 660, height: SKETCH_HEIGHT_PX })
  })

  it('is a no-op without points', () => {
    const canvas = { width: 400, height: 400 }
    expect(fitCanvasToContent(canvas, [])).toBe(canvas)
  })
})

describe('ratio helpers', () => {
  it('formats wide and tall ratios', () => {
    expect(formatAspectRatio(2.68)).toBe('2.7 : 1')
    expect(formatAspectRatio(1)).toBe('1 : 1')
    expect(formatAspectRatio(1 / 1.5)).toBe('1 : 1.5')
  })

  it('flags ratios beyond 2:1 or below 1:2', () => {
    expect(isExtremeRatio(2.7)).toBe(true)
    expect(isExtremeRatio(0.4)).toBe(true)
    expect(isExtremeRatio(2)).toBe(false)
    expect(isExtremeRatio(0.5)).toBe(false)
  })
})
