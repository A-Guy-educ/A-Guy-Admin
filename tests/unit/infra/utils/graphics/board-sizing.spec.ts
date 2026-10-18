import { describe, expect, it } from 'vitest'

import {
  computeBoardSize,
  SKETCH_HEIGHT_PX,
  SKETCH_MIN_WIDTH_PX,
  SKETCH_MAX_CONTAINER_FRACTION,
} from '@/infra/utils/graphics/board-sizing'

describe('computeBoardSize (existing sketch spec)', () => {
  it('always returns the fixed sketch height', () => {
    const r = computeBoardSize({ xRange: 10, yRange: 10, availableWidth: 1000 })
    expect(r.height).toBe(SKETCH_HEIGHT_PX)
  })

  it('derives width from viewport aspect ratio × height', () => {
    // aspect 2:1 (wide) → width = 330 × 2 = 660; container cap is 1000 × 0.75 = 750, so natural wins
    const r = computeBoardSize({ xRange: 20, yRange: 10, availableWidth: 1000 })
    expect(r.width).toBeCloseTo(SKETCH_HEIGHT_PX * 2, 5)
  })

  it('clamps width to 75% of the container when the aspect would exceed it', () => {
    // aspect 10:1 → natural width 3300; cap at 75% × 1000 = 750
    const r = computeBoardSize({ xRange: 100, yRange: 10, availableWidth: 1000 })
    expect(r.width).toBe(1000 * SKETCH_MAX_CONTAINER_FRACTION)
  })

  it('clamps width up to the min when the aspect would fall below it', () => {
    // aspect 1:10 → natural width 33; snap up to min 280
    const r = computeBoardSize({ xRange: 10, yRange: 100, availableWidth: 1000 })
    expect(r.width).toBe(SKETCH_MIN_WIDTH_PX)
  })

  it('allows exceeding 75% when the container is too narrow for 75% to reach the min', () => {
    // container 300 → 75% is 225, below min 280. Fallback: render at 280 even though it's ~93%.
    const r = computeBoardSize({ xRange: 10, yRange: 10, availableWidth: 300 })
    expect(r.width).toBe(SKETCH_MIN_WIDTH_PX)
  })

  it('uses the full container width when the container itself is narrower than the min', () => {
    // Spec: no horizontal scroll / no overflow — on a 240px screen render at 240.
    const r = computeBoardSize({ xRange: 10, yRange: 10, availableWidth: 240 })
    expect(r.width).toBe(240)
    expect(r.height).toBe(SKETCH_HEIGHT_PX)
  })

  it('applies the x/y proportion to the aspect ratio', () => {
    // Square viewport but proportion=2 → aspect 2:1 after scaling
    const r = computeBoardSize({ xRange: 10, yRange: 10, availableWidth: 2000, proportion: 2 })
    expect(r.width).toBeCloseTo(SKETCH_HEIGHT_PX * 2, 5)
  })

  it('falls back to the min width for a degenerate viewport', () => {
    const r = computeBoardSize({ xRange: 0, yRange: 0, availableWidth: 1000 })
    expect(r.width).toBe(SKETCH_MIN_WIDTH_PX)
    expect(r.height).toBe(SKETCH_HEIGHT_PX)
  })

  it('honors widthOverride for new-schema blocks (clamped to container)', () => {
    const r = computeBoardSize({
      xRange: 10,
      yRange: 10,
      availableWidth: 1000,
      widthOverride: 400,
      heightOverride: 400,
    })
    expect(r.width).toBe(400)
    expect(r.height).toBe(400)
  })

  it('clamps widthOverride to the container width (no overflow)', () => {
    const r = computeBoardSize({
      xRange: 10,
      yRange: 10,
      availableWidth: 300,
      widthOverride: 500,
      heightOverride: 400,
    })
    expect(r.width).toBe(300)
    expect(r.height).toBe(400)
  })
})
