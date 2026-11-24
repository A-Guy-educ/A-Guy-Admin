import { describe, expect, it } from 'vitest'

import {
  computeContentBoundingBox,
  computeContentExtent,
  isContentOutsideBox,
} from '@/infra/utils/graphics/geometry-content-bounds'

const A = { name: 'A', x: 100, y: 100 }
const B = { name: 'B', x: 200, y: 200 }
const O = { name: 'O', x: 200, y: 200 }

describe('computeContentExtent', () => {
  it('returns null without usable points', () => {
    expect(computeContentExtent([])).toBeNull()
    expect(computeContentExtent([{ name: '', x: 1, y: 1 }])).toBeNull()
    expect(computeContentExtent([{ name: 'A', x: NaN, y: 1 }])).toBeNull()
  })

  it('grows for numeric-radius and through-point circles', () => {
    expect(computeContentExtent([A, O], [{ center: 'O', radius: 50 }])).toEqual({
      xMin: 100,
      xMax: 250,
      yMin: 100,
      yMax: 250,
    })
    const T = { name: 'T', x: 100, y: 160 }
    const C = { name: 'C', x: 100, y: 100 }
    expect(computeContentExtent([C, T], [{ center: 'C', through: 'T' }])).toEqual({
      xMin: 40,
      xMax: 160,
      yMin: 40,
      yMax: 160,
    })
  })

  it('skips circles whose center is not a local point', () => {
    expect(computeContentExtent([A, B], [{ center: 'X', radius: 500 }])).toEqual({
      xMin: 100,
      xMax: 200,
      yMin: 100,
      yMax: 200,
    })
  })
})

describe('computeContentBoundingBox', () => {
  it('pads 10% per side', () => {
    expect(computeContentBoundingBox([A, B])).toEqual([90, 210, 210, 90])
  })

  it('pads a flat axis by a fixed amount', () => {
    const box = computeContentBoundingBox([A, { name: 'C', x: 200, y: 100 }])!
    expect(box[1] - box[3]).toBe(40)
  })
})

describe('isContentOutsideBox', () => {
  it('detects a point dragged outside the box', () => {
    expect(isContentOutsideBox([90, 210, 210, 90], [A, B])).toBe(false)
    expect(isContentOutsideBox([90, 210, 210, 90], [A, { name: 'B', x: 300, y: 200 }])).toBe(true)
  })

  it('detects a circle poking outside the box', () => {
    expect(isContentOutsideBox([90, 210, 210, 90], [A, O], [{ center: 'O', radius: 50 }])).toBe(
      true,
    )
  })

  it('is false without points', () => {
    expect(isContentOutsideBox([0, 1, 1, 0], [])).toBe(false)
  })
})
