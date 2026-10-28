import { describe, expect, it } from 'vitest'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'

// Import the utilities we're testing - these will fail until implemented
import {
  calculateAutoViewport,
  validateViewportRange,
  checkGraphVisibility,
  resolveViewport,
  withFeaturePointViewport,
} from '@/infra/utils/graphics/viewport-utils'

describe('viewport-utils', () => {
  // FR-001: Automatic Range Calculation
  describe('calculateAutoViewport', () => {
    it('returns default range when no elements exist', () => {
      const emptySpec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [],
          graphs: [],
        },
      }

      const result = calculateAutoViewport(emptySpec)
      expect(result.xMin).toBe(-10)
      expect(result.xMax).toBe(10)
      expect(result.yMin).toBe(-10)
      expect(result.yMax).toBe(10)
    })

    it('includes all points with padding', () => {
      const specWithPoints: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [
            { x: 2, y: 3, type: 'point' },
            { x: -5, y: 7, type: 'point' },
          ],
          graphs: [],
        },
      }

      const result = calculateAutoViewport(specWithPoints)
      // Should contain all points with some padding
      expect(result.xMin).toBeLessThanOrEqual(-5)
      expect(result.xMax).toBeGreaterThanOrEqual(2)
      expect(result.yMin).toBeLessThanOrEqual(3)
      expect(result.yMax).toBeGreaterThanOrEqual(7)
    })

    it('fits auto viewport around feature points of a single-graph spec', () => {
      // The viewport is anchored on landmark points — the graph's y-intercept
      // and x-intercept — rather than sampling the function across [-10, 10].
      // For `x^2` alone the only landmark is the origin, so we expand to the
      // minimum readable window around it (centered on 0, span ≥ 4 on each
      // axis before padding).
      const specWithGraph: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [],
          graphs: [
            {
              id: 'g1',
              fn: 'x^2',
              style: 'solid',
              thickness: 2,
            },
          ],
        },
      }

      const result = calculateAutoViewport(specWithGraph)
      // Centered on origin, both axes span the min feature span + padding.
      expect(result.xMin).toBeLessThanOrEqual(-2)
      expect(result.xMax).toBeGreaterThanOrEqual(2)
      expect(result.yMin).toBeLessThanOrEqual(0)
      expect(result.yMax).toBeGreaterThanOrEqual(0)
      // Must not blow up to [-10, 10] y: [0, 100] like the old sample window did.
      expect(result.yMax).toBeLessThan(20)
    })

    it('fits auto viewport around graph intersections and intercepts', () => {
      // Three lines (y=2x+1, y=-x+3, y=2) intersecting around x≈0.5–1, y≈2–2.33.
      // The viewport should sit snugly around the intersection cluster plus
      // axis intercepts, not sample lines across [-10, 10] and inflate.
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [],
          graphs: [
            { id: 'g1', fn: '2*x+1', style: 'solid', thickness: 2 },
            { id: 'g2', fn: '-x+3', style: 'solid', thickness: 2 },
            { id: 'g3', fn: '2', style: 'solid', thickness: 2 },
          ],
        },
      }

      const result = calculateAutoViewport(spec)
      // Must include the three intersection points (≈(0.67, 2.33), (0.5, 2), (1, 2))
      // plus the y-intercepts (0, 1), (0, 3), (0, 2) and x-intercepts (-0.5, 0), (3, 0).
      expect(result.xMin).toBeLessThanOrEqual(-0.5)
      expect(result.xMax).toBeGreaterThanOrEqual(3)
      expect(result.yMin).toBeLessThanOrEqual(0)
      expect(result.yMax).toBeGreaterThanOrEqual(3)
      // But not the sprawling [-10, 10]-sampled range the old logic produced.
      expect(result.xMin).toBeGreaterThan(-10)
      expect(result.yMax).toBeLessThan(20)
    })

    it('fits first-quadrant anchor content without extending to negative defaults', () => {
      // Regression: before this fix, calculateAutoViewport started from
      // defaults -10..10 and only expanded via Math.min/max. A point at
      // (3, 4) produced xMin=-10, yMin=-10 — the viewport looked like
      // the axes were mirrored to negative space.
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [
            { x: 1, y: 2, type: 'point' },
            { x: 3, y: 4, type: 'point' },
          ],
          graphs: [],
        },
      }

      const result = calculateAutoViewport(spec)
      // Should sit tight around the first-quadrant anchor, not pulled to -10
      expect(result.xMin).toBeGreaterThanOrEqual(-1)
      expect(result.yMin).toBeGreaterThanOrEqual(0)
      // Padding is 10% of span (min 1 unit), so bounds are ~[0..4, 1..5]
      expect(result.xMax).toBeGreaterThanOrEqual(3)
      expect(result.yMax).toBeGreaterThanOrEqual(4)
    })
  })

  // FR-004: Min-Max Validation
  describe('validateViewportRange', () => {
    it('returns valid for correct range', () => {
      const result = validateViewportRange({
        xMin: -5,
        xMax: 5,
        yMin: -10,
        yMax: 10,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns error when xMin >= xMax', () => {
      const result = validateViewportRange({
        xMin: 10,
        xMax: 5,
        yMin: -10,
        yMax: 10,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('X-min must be less than X-max')
    })

    it('returns error when yMin >= yMax', () => {
      const result = validateViewportRange({
        xMin: -5,
        xMax: 5,
        yMin: 10,
        yMax: -10,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Y-min must be less than Y-max')
    })

    it('returns error for non-finite values (NaN)', () => {
      const result = validateViewportRange({
        xMin: NaN,
        xMax: 5,
        yMin: -10,
        yMax: 10,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('X-min must be a valid number')
    })

    it('returns error for Infinity', () => {
      const result = validateViewportRange({
        xMin: -Infinity,
        xMax: 5,
        yMin: -10,
        yMax: 10,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('X-min must be a valid number')
    })

    it('returns multiple errors when both x and y are invalid', () => {
      const result = validateViewportRange({
        xMin: 10,
        xMax: 5,
        yMin: 10,
        yMax: -10,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
      expect(result.errors).toContain('X-min must be less than X-max')
      expect(result.errors).toContain('Y-min must be less than Y-max')
    })
  })

  // FR-006: Empty Grid Warning
  describe('checkGraphVisibility', () => {
    it('returns visible when graph is within viewport', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [],
          graphs: [
            {
              id: 'g1',
              fn: 'x^2',
              style: 'solid',
              thickness: 2,
            },
          ],
        },
      }

      const viewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
      const result = checkGraphVisibility(spec, viewport)

      expect(result.visible).toBe(true)
      expect(result.warning).toBeNull()
    })

    it('returns not visible when graph y-values are outside viewport', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [],
          graphs: [
            {
              id: 'g1',
              fn: 'x^2',
              style: 'solid',
              thickness: 2,
            },
          ],
        },
      }

      // Viewport with y range above where x^2 is (x^2 maxes at 100 in [-10,10] range)
      // Using yMin=101 ensures x^2 values (0-100) are all below viewport
      const viewport = { xMin: -10, xMax: 10, yMin: 101, yMax: 200 }
      const result = checkGraphVisibility(spec, viewport)

      expect(result.visible).toBe(false)
      expect(result.warning).toContain('Warning')
      expect(result.warning).toContain('No graph content is visible')
    })

    it('returns visible when at least one point is in viewport', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [
            { x: 2, y: 3, type: 'point' }, // Inside viewport
            { x: 100, y: 100, type: 'point' }, // Outside viewport
          ],
          graphs: [],
        },
      }

      const viewport = { xMin: 0, xMax: 5, yMin: 0, yMax: 5 }
      const result = checkGraphVisibility(spec, viewport)

      expect(result.visible).toBe(true)
      expect(result.warning).toBeNull()
    })

    it('returns not visible when all points are outside viewport', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [
            { x: 50, y: 60, type: 'point' }, // Way outside viewport
          ],
          graphs: [],
        },
      }

      const viewport = { xMin: 0, xMax: 5, yMin: 0, yMax: 5 }
      const result = checkGraphVisibility(spec, viewport)

      expect(result.visible).toBe(false)
      expect(result.warning).toContain('Warning')
    })
  })

  // FR-002: Manual Override + FR-008: Schema Extension
  describe('resolveViewport', () => {
    it('returns manual viewport when viewportMode is manual with complete viewport', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: -5, xMax: 5, yMin: -20, yMax: 20 },
        elements: {
          points: [],
          graphs: [],
        },
      }

      const result = resolveViewport(spec)

      expect(result.xMin).toBe(-5)
      expect(result.xMax).toBe(5)
      expect(result.yMin).toBe(-20)
      expect(result.yMax).toBe(20)
    })

    it('returns auto-calculated viewport when viewportMode is auto', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'auto',
        viewport: { xMin: -5, xMax: 5, yMin: -20, yMax: 20 },
        elements: {
          points: [{ x: 2, y: 3, type: 'point' }],
          graphs: [],
        },
      }

      const result = resolveViewport(spec)

      // Should NOT return manual values, should fit tightly around the point.
      expect(result.yMin).toBeGreaterThan(-20)
      expect(result.yMax).toBeLessThan(20)
      // Y must still include the point.
      expect(result.yMin).toBeLessThanOrEqual(3)
      expect(result.yMax).toBeGreaterThanOrEqual(3)
    })

    it('returns auto-calculated viewport when viewportMode is undefined (backward compat)', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        // No viewportMode field - backward compatibility
        viewport: { xMin: -5, xMax: 5, yMin: -20, yMax: 20 },
        elements: {
          points: [{ x: 2, y: 3, type: 'point' }],
          graphs: [],
        },
      }

      const result = resolveViewport(spec)

      // Should default to auto mode
      expect(result.xMin).not.toBe(-5)
    })

    it('honors a manual viewport wider than the anchor content', () => {
      // Regression: render-time tightening snapped xMax back to anchor+1
      // whenever content filled <50% of the x span, so an admin with all
      // points at x in [-7, -3] could not set xMax above 0.
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: -8, xMax: 4, yMin: -2, yMax: 8 },
        elements: {
          points: [
            { x: -7, y: 2, type: 'point' },
            { x: -3, y: 2, type: 'point' },
            { x: -3, y: 5, type: 'point' },
          ],
          graphs: [],
        },
      }

      const result = resolveViewport(spec)

      // x span 12 vs y span 10 is within the 1.2 aspect limit — untouched.
      expect(result).toEqual({ xMin: -8, xMax: 4, yMin: -2, yMax: 8 })
    })

    it('keeps a well-fit manual viewport unchanged', () => {
      // When content occupies a healthy fraction of the viewport in both
      // dimensions, trust the author's choice (there may be a pedagogical
      // reason for the margin).
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
        elements: {
          points: [
            { x: 1, y: 1, type: 'point' },
            { x: 8, y: 8, type: 'point' },
          ],
          graphs: [],
        },
      }

      const result = resolveViewport(spec)
      // Anchor spans 7/10 = 70% of each dim — above threshold, untouched.
      expect(result).toEqual({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 })
    })

    it('clamps the viewport aspect when a graph-only spec has a tall manual viewport', () => {
      // User's reported case: LLM-generated .txt with 3 lines but no explicit
      // points. Manual viewport came out tall (2:1 y:x), making the render
      // box taller than a mobile screen. Tightening doesn't fire (no anchor),
      // so the aspect clamp has to widen x symmetrically.
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: -3.5, xMax: 3.5, yMin: -5, yMax: 9 },
        elements: {
          points: [],
          graphs: [
            { id: 'g1', fn: 'x+1', style: 'solid', thickness: 2 },
            { id: 'g2', fn: '-x+4', style: 'solid', thickness: 2 },
            { id: 'g3', fn: '2', style: 'solid', thickness: 2 },
          ],
        },
      }

      const result = resolveViewport(spec)
      const xSpan = result.xMax - result.xMin
      const ySpan = result.yMax - result.yMin
      // Aspect ratio must be within the 1.2 clamp
      expect(ySpan / xSpan).toBeLessThanOrEqual(1.2 + 0.001)
      // Y must be preserved (never shrunk)
      expect(result.yMin).toBe(-5)
      expect(result.yMax).toBe(9)
      // X widened symmetrically around the original center (0)
      expect(result.xMin).toBeLessThanOrEqual(-3.5)
      expect(result.xMax).toBeGreaterThanOrEqual(3.5)
      expect(result.xMin + result.xMax).toBeCloseTo(0, 5)
    })

    it('clamps a wide manual viewport by growing y symmetrically', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: -20, xMax: 20, yMin: 0, yMax: 4 },
        elements: {
          points: [],
          graphs: [{ id: 'g1', fn: '2', style: 'solid', thickness: 2 }],
        },
      }

      const result = resolveViewport(spec)
      const xSpan = result.xMax - result.xMin
      const ySpan = result.yMax - result.yMin
      expect(xSpan / ySpan).toBeLessThanOrEqual(1.2 + 0.001)
      // X preserved
      expect(result.xMin).toBe(-20)
      expect(result.xMax).toBe(20)
      // Y widened symmetrically around original center (2)
      expect(result.yMin).toBeLessThanOrEqual(0)
      expect(result.yMax).toBeGreaterThanOrEqual(4)
      expect(result.yMin + result.yMax).toBeCloseTo(4, 5)
    })

    it('does NOT clamp when the spec has no renderable content', () => {
      // Empty spec with an extreme manual viewport: author's declared
      // bounds are the only signal, so honor them untouched.
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: -5, xMax: 5, yMin: -20, yMax: 20 },
        elements: { points: [], graphs: [] },
      }

      const result = resolveViewport(spec)
      expect(result).toEqual({ xMin: -5, xMax: 5, yMin: -20, yMax: 20 })
    })
  })

  describe('withFeaturePointViewport (import-time baking)', () => {
    it('overrides a wasteful LLM-written manual viewport with feature-point bounds', () => {
      // Mirrors the real-world case the content manager hit: the LLM
      // wrote a manual viewport of x=[-12,12], y=[-22,22] for three
      // lines whose intersections cluster around (0.5, 2). Importer
      // should bake tight feature-point bounds, not store the LLM's.
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'manual',
        viewport: { xMin: -12, xMax: 12, yMin: -22, yMax: 22 },
        elements: {
          points: [],
          graphs: [
            { id: 'g1', fn: '2*x+1', style: 'solid', thickness: 2 },
            { id: 'g2', fn: '-x+3', style: 'solid', thickness: 2 },
            { id: 'g3', fn: '2', style: 'solid', thickness: 2 },
          ],
        },
      }

      const baked = withFeaturePointViewport(spec)
      expect(baked.viewportMode).toBe('manual')
      // Much tighter than the LLM's bounds
      expect(baked.viewport!.xMin!).toBeGreaterThan(-12)
      expect(baked.viewport!.xMax!).toBeLessThan(12)
      expect(baked.viewport!.yMin!).toBeGreaterThan(-22)
      expect(baked.viewport!.yMax!).toBeLessThan(22)
      // Still includes the intersection cluster
      expect(baked.viewport!.xMin!).toBeLessThanOrEqual(0.5)
      expect(baked.viewport!.xMax!).toBeGreaterThanOrEqual(1)
      expect(baked.viewport!.yMax!).toBeGreaterThanOrEqual(3)
    })

    it('bakes a viewport for auto-mode specs with no stored bounds', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'auto',
        elements: {
          points: [],
          graphs: [{ id: 'g1', fn: '2*x+1', style: 'solid', thickness: 2 }],
        },
      }

      const baked = withFeaturePointViewport(spec)
      expect(baked.viewportMode).toBe('manual')
      expect(baked.viewport!.xMin).toBeDefined()
      expect(baked.viewport!.xMax).toBeDefined()
    })

    it('leaves an empty spec untouched (no graph content to compute from)', () => {
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'auto',
        viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
        elements: { points: [], graphs: [] },
      }

      const baked = withFeaturePointViewport(spec)
      // Author's declared viewport preserved — nothing to compute from
      expect(baked.viewportMode).toBe('auto')
      expect(baked.viewport).toEqual({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 })
    })

    it('rounds bounds to 4 decimal places for storage cleanliness', () => {
      // sqrt(2) intercepts in x^2 = 2 → test precision cap
      const spec: AxisSpecV1 = {
        kind: 'cartesian',
        units: 1,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewportMode: 'auto',
        elements: {
          points: [],
          graphs: [
            { id: 'g1', fn: 'x^2', style: 'solid', thickness: 2 },
            { id: 'g2', fn: '2', style: 'solid', thickness: 2 },
          ],
        },
      }

      const baked = withFeaturePointViewport(spec)
      for (const v of [
        baked.viewport!.xMin!,
        baked.viewport!.xMax!,
        baked.viewport!.yMin!,
        baked.viewport!.yMax!,
      ]) {
        expect(v).toBeCloseTo(Math.round(v * 10000) / 10000, 10)
      }
    })
  })
})
