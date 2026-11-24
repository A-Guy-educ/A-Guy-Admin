import { describe, expect, it } from 'vitest'

import { fitBoundingBoxToBoard } from '@/infra/utils/graphics/bounding-box-fit'

const pxPerUnit = (box: number[], width: number, height: number) => ({
  x: width / (box[2] - box[0]),
  y: height / (box[1] - box[3]),
})

describe('fitBoundingBoxToBoard', () => {
  it('returns the box unchanged when it already matches the board', () => {
    expect(fitBoundingBoxToBoard([0, 10, 20, 0], 400, 200)).toEqual([0, 10, 20, 0])
  })

  it('pads x evenly when the board is wider than the box', () => {
    // 10×10 box on a 280×140 board → 14 px/unit on y, x widens to 20 units
    const box = fitBoundingBoxToBoard([0, 10, 10, 0], 280, 140)
    expect(box).toEqual([-5, 10, 15, 0])
    const units = pxPerUnit(box, 280, 140)
    expect(units.x).toBeCloseTo(units.y, 10)
  })

  it('pads y evenly when the board is taller than the box', () => {
    const box = fitBoundingBoxToBoard([0, 10, 20, 0], 280, 330)
    const units = pxPerUnit(box, 280, 330)
    expect(units.x).toBeCloseTo(units.y, 10)
    expect(box[0]).toBe(0)
    expect(box[2]).toBe(20)
    expect(box[1] - 10).toBeCloseTo(0 - box[3], 10)
  })

  it('ignores degenerate input', () => {
    expect(fitBoundingBoxToBoard([0, 0, 0, 0], 300, 300)).toEqual([0, 0, 0, 0])
    expect(fitBoundingBoxToBoard([0, 10, 10, 0], 0, 300)).toEqual([0, 10, 10, 0])
  })
})
