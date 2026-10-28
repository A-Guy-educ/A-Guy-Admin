/**
 * @fileType utility
 * @domain graphics
 * @pattern viewport-calculation
 * @ai-summary Viewport utility functions for auto-calculating, validating, and resolving graph display ranges
 */

import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'

/**
 * Viewport bounds
 */
export interface ViewportBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/**
 * Validation result
 */
export interface ViewportValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Visibility check result
 */
export interface GraphVisibilityResult {
  visible: boolean
  warning: string | null
}

/**
 * Safely evaluate a math expression string at a given x value
 * Returns null if evaluation fails
 */
function evaluateMathExpression(fn: string, x: number): number | null {
  try {
    // Replace ^ with ** for JavaScript exponentiation
    const jsFn = fn.replace(/\^/g, '**')
    const fnWithX = new Function('x', `return ${jsFn}`)
    const result = fnWithX(x)
    if (!Number.isFinite(result)) return null
    return result
  } catch {
    return null
  }
}

/**
 * Content bounds collected from "anchor" elements — the things we treat as
 * authoritative for where the viewport should fit: points, line segment
 * endpoints, and explicit asymptotes. We deliberately exclude unbounded
 * `graphs` (functions of x) because they have no natural x-range of their
 * own — sampling them across an arbitrary window (previously [-10, 10])
 * inflates y-bounds whenever a line extends far, which is exactly the
 * "symmetric wasteland" that bugged graph viewports.
 *
 * Returns `null` when no anchor content exists; callers substitute a
 * default or honor an author's manual viewport.
 */
function collectAnchorBounds(spec: AxisSpecV1): ViewportBounds | null {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  let hasContent = false

  for (const point of spec.elements.points) {
    hasContent = true
    xMin = Math.min(xMin, point.x)
    xMax = Math.max(xMax, point.x)
    yMin = Math.min(yMin, point.y)
    yMax = Math.max(yMax, point.y)
  }

  for (const line of spec.elements.lineBetweenPoints || []) {
    hasContent = true
    xMin = Math.min(xMin, line.a.x, line.b.x)
    xMax = Math.max(xMax, line.a.x, line.b.x)
    yMin = Math.min(yMin, line.a.y, line.b.y)
    yMax = Math.max(yMax, line.a.y, line.b.y)
  }

  for (const xVal of spec.elements.asymptotesVertical || []) {
    hasContent = true
    xMin = Math.min(xMin, xVal)
    xMax = Math.max(xMax, xVal)
  }

  for (const yVal of spec.elements.asymptotesHorizontal || []) {
    hasContent = true
    yMin = Math.min(yMin, yVal)
    yMax = Math.max(yMax, yVal)
  }

  if (!hasContent) return null
  return { xMin, xMax, yMin, yMax }
}

/** Width of the window we scan for intersections and axis crossings. */
const FEATURE_SCAN_MIN = -10
const FEATURE_SCAN_MAX = 10
const FEATURE_SCAN_SAMPLES = 200

/**
 * Bisect to a precise root of `diffFn(x) = 0` inside `[a, b]`, assuming
 * `diffFn` has a sign change on the interval. Returns `null` if either
 * endpoint fails to evaluate or the signs don't bracket a root.
 */
function bisectRoot(
  diffFn: (x: number) => number | null,
  a: number,
  b: number,
  tol = 1e-6,
  maxIter = 50,
): number | null {
  let lo = a
  let hi = b
  let flo = diffFn(lo)
  const fhi = diffFn(hi)
  if (flo === null || fhi === null) return null
  if (flo === 0) return lo
  if (fhi === 0) return hi
  if (flo * fhi > 0) return null
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2
    const fmid = diffFn(mid)
    if (fmid === null) return null
    if (Math.abs(fmid) < tol || (hi - lo) / 2 < tol) return mid
    if (flo * fmid < 0) {
      hi = mid
    } else {
      lo = mid
      flo = fmid
    }
  }
  return (lo + hi) / 2
}

/**
 * Sample `diffFn(x)` across `[FEATURE_SCAN_MIN, FEATURE_SCAN_MAX]` and
 * bisect every sign change to find roots. Used both for intersections
 * (f(x) - g(x) = 0) and x-intercepts (f(x) = 0).
 */
function findSignChangeRoots(diffFn: (x: number) => number | null): number[] {
  const roots: number[] = []
  const span = FEATURE_SCAN_MAX - FEATURE_SCAN_MIN
  let prevX = FEATURE_SCAN_MIN
  let prevV = diffFn(prevX)
  for (let i = 1; i <= FEATURE_SCAN_SAMPLES; i++) {
    const x = FEATURE_SCAN_MIN + (i / FEATURE_SCAN_SAMPLES) * span
    const v = diffFn(x)
    if (prevV !== null && v !== null && prevV !== v && prevV * v <= 0) {
      const root = bisectRoot(diffFn, prevX, x)
      if (root !== null) roots.push(root)
    }
    prevX = x
    prevV = v
  }
  return roots
}

/**
 * Collect the "interesting" points that an educator would want in view
 * for a given spec: author-placed points, line endpoints, y-intercepts,
 * x-intercepts, and pairwise graph intersections. These landmark points
 * drive the auto-viewport bounds — the viewport fits them snugly
 * (plus padding), instead of sampling graphs across an arbitrary x
 * window and ballooning when a line extends far.
 */
function collectFeaturePoints(spec: AxisSpecV1): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []

  for (const p of spec.elements.points) points.push({ x: p.x, y: p.y })
  for (const l of spec.elements.lineBetweenPoints ?? []) {
    points.push({ x: l.a.x, y: l.a.y })
    points.push({ x: l.b.x, y: l.b.y })
  }

  const graphs = spec.elements.graphs
  for (const g of graphs) {
    // y-intercept: f(0)
    const y0 = evaluateMathExpression(g.fn, 0)
    if (y0 !== null) points.push({ x: 0, y: y0 })
    // x-intercepts: solve f(x) = 0 in the scan window
    for (const xRoot of findSignChangeRoots((x) => evaluateMathExpression(g.fn, x))) {
      points.push({ x: xRoot, y: 0 })
    }
  }

  // Pairwise intersections of graphs
  for (let i = 0; i < graphs.length; i++) {
    for (let j = i + 1; j < graphs.length; j++) {
      const fnA = graphs[i].fn
      const fnB = graphs[j].fn
      const diff = (x: number) => {
        const a = evaluateMathExpression(fnA, x)
        const b = evaluateMathExpression(fnB, x)
        return a === null || b === null ? null : a - b
      }
      for (const xRoot of findSignChangeRoots(diff)) {
        const y = evaluateMathExpression(fnA, xRoot)
        if (y !== null) points.push({ x: xRoot, y })
      }
    }
  }

  return points
}

/** Minimum extent on each axis — a single feature point still gets a visible window. */
const MIN_FEATURE_SPAN = 4

/**
 * Calculate the auto viewport based on graph elements
 * Analyzes points, graphs, asymptotes, and line segments to determine a bounding box
 */
export function calculateAutoViewport(spec: AxisSpecV1): ViewportBounds {
  const DEFAULT_BOUNDS: ViewportBounds = {
    xMin: -10,
    xMax: 10,
    yMin: -10,
    yMax: 10,
  }

  const anchor = collectAnchorBounds(spec)
  const features = collectFeaturePoints(spec)

  // If we have no anchor AND no derived features, the spec is empty —
  // fall back to the classroom default.
  if (!anchor && features.length === 0) {
    return DEFAULT_BOUNDS
  }

  // Combine anchor bounds with feature-point bounds. Features drive the
  // viewport for pure-graph specs (no author-placed points); when the
  // author DID place points, those still contribute via the anchor path.
  let xMin = anchor?.xMin ?? Infinity
  let xMax = anchor?.xMax ?? -Infinity
  let yMin = anchor?.yMin ?? Infinity
  let yMax = anchor?.yMax ?? -Infinity

  for (const p of features) {
    xMin = Math.min(xMin, p.x)
    xMax = Math.max(xMax, p.x)
    yMin = Math.min(yMin, p.y)
    yMax = Math.max(yMax, p.y)
  }

  // Guarantee a readable window around a single feature point (e.g. the
  // vertex of a lonely parabola) by expanding each axis to at least
  // MIN_FEATURE_SPAN.
  if (xMax - xMin < MIN_FEATURE_SPAN) {
    const cx = (xMin + xMax) / 2
    xMin = cx - MIN_FEATURE_SPAN / 2
    xMax = cx + MIN_FEATURE_SPAN / 2
  }
  if (yMax - yMin < MIN_FEATURE_SPAN) {
    const cy = (yMin + yMax) / 2
    yMin = cy - MIN_FEATURE_SPAN / 2
    yMax = cy + MIN_FEATURE_SPAN / 2
  }

  // Add 10% padding (minimum 1 unit)
  const xPadding = Math.max(1, (xMax - xMin) * 0.1)
  const yPadding = Math.max(1, (yMax - yMin) * 0.1)

  return {
    xMin: xMin - xPadding,
    xMax: xMax + xPadding,
    yMin: yMin - yPadding,
    yMax: yMax + yPadding,
  }
}

/**
 * Round viewport bounds to 4 decimal places. Keeps stored docs clean in
 * Compass without visible precision loss (intersections at e.g. √2 still
 * resolve to the same y-value within rendering tolerance).
 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/**
 * Return a copy of `spec` with its viewport baked to the feature-point
 * auto-viewport (manual mode). Used at import time so new content lands
 * with good bounds regardless of what the generator wrote in its
 * `x:[…]` / `y:[…]` DSL. Mirrors the one-shot heal script (`scripts/
 * heal-axis-viewports.mts`) but applies on every create, so the viewport
 * is correct in Mongo without needing a batch job.
 *
 * No-op when the spec has no graph content to compute from — the parsed
 * viewport (if any) is left untouched in that case.
 */
export function withFeaturePointViewport<T extends AxisSpecV1>(spec: T): T {
  const hasGraphs = (spec.elements?.graphs?.length ?? 0) > 0
  const hasAnchors = collectAnchorBounds(spec) !== null
  if (!hasGraphs && !hasAnchors) return spec

  const bounds = calculateAutoViewport(spec)
  return {
    ...spec,
    viewportMode: 'manual',
    viewport: {
      xMin: round4(bounds.xMin),
      xMax: round4(bounds.xMax),
      yMin: round4(bounds.yMin),
      yMax: round4(bounds.yMax),
    },
  }
}

/**
 * Validate viewport range values
 */
export function validateViewportRange(viewport: ViewportBounds): ViewportValidationResult {
  const errors: string[] = []

  // Check all values are finite numbers
  if (!Number.isFinite(viewport.xMin)) {
    errors.push('X-min must be a valid number')
  }
  if (!Number.isFinite(viewport.xMax)) {
    errors.push('X-max must be a valid number')
  }
  if (!Number.isFinite(viewport.yMin)) {
    errors.push('Y-min must be a valid number')
  }
  if (!Number.isFinite(viewport.yMax)) {
    errors.push('Y-max must be a valid number')
  }

  // If there are numeric errors, don't check min/max
  if (errors.length > 0) {
    return { valid: false, errors }
  }

  // Check xMin < xMax
  if (viewport.xMin >= viewport.xMax) {
    errors.push('X-min must be less than X-max')
  }

  // Check yMin < yMax
  if (viewport.yMin >= viewport.yMax) {
    errors.push('Y-min must be less than Y-max')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Check if graph content is visible within the viewport
 */
export function checkGraphVisibility(
  spec: AxisSpecV1,
  viewport: ViewportBounds,
): GraphVisibilityResult {
  const sampleCount = 20

  // Check graphs
  for (const graph of spec.elements.graphs) {
    let hasVisiblePoint = false

    for (let i = 0; i <= sampleCount; i++) {
      const x = viewport.xMin + (i / sampleCount) * (viewport.xMax - viewport.xMin)
      const y = evaluateMathExpression(graph.fn, x)

      if (y !== null && y >= viewport.yMin && y <= viewport.yMax) {
        hasVisiblePoint = true
        break
      }
    }

    if (hasVisiblePoint) {
      return { visible: true, warning: null }
    }
  }

  // Check points
  for (const point of spec.elements.points) {
    if (
      point.x >= viewport.xMin &&
      point.x <= viewport.xMax &&
      point.y >= viewport.yMin &&
      point.y <= viewport.yMax
    ) {
      return { visible: true, warning: null }
    }
  }

  // Check line segments
  for (const line of spec.elements.lineBetweenPoints || []) {
    // Check if line segment intersects viewport
    const minX = Math.min(line.a.x, line.b.x)
    const maxX = Math.max(line.a.x, line.b.x)
    const minY = Math.min(line.a.y, line.b.y)
    const maxY = Math.max(line.a.y, line.b.y)

    if (
      !(
        maxX < viewport.xMin ||
        minX > viewport.xMax ||
        maxY < viewport.yMin ||
        minY > viewport.yMax
      )
    ) {
      return { visible: true, warning: null }
    }
  }

  // No content visible
  return {
    visible: false,
    warning: 'Warning: No graph content is visible in the configured range.',
  }
}

/**
 * Max allowed ratio between the longer and shorter viewport dimension.
 * The pixel container in `computeBoardSize` matches the viewport aspect
 * so grid squares stay square — but when the aspect is extreme the
 * container becomes a thin strip, which is unreadable on mobile and
 * causes the "graph taller than my screen" complaint. Clamping the
 * viewport (not the pixel box) preserves correct line angles while
 * keeping the rendered box in a usable shape.
 *
 * 1.2 lets us hit the common offenders (symmetric `-6..6` on y combined
 * with a tight x range) without ballooning the viewport for authors
 * who intentionally picked a slightly tall or wide window.
 */
const MAX_VIEWPORT_ASPECT = 1.2

/**
 * Any element that signals a non-empty spec. Graphs count because
 * they're the common LLM-generated case (lines/curves with no explicit
 * points) where the aspect clamp needs to fire.
 */
function hasAnyRenderableContent(spec: AxisSpecV1): boolean {
  return (
    spec.elements.points.length > 0 ||
    spec.elements.graphs.length > 0 ||
    (spec.elements.lineBetweenPoints?.length ?? 0) > 0 ||
    (spec.elements.asymptotesVertical?.length ?? 0) > 0 ||
    (spec.elements.asymptotesHorizontal?.length ?? 0) > 0 ||
    (spec.elements.geometricLoci?.length ?? 0) > 0
  )
}

/**
 * Expand the shorter dimension symmetrically so neither axis is more
 * than MAX_VIEWPORT_ASPECT times the other. Never shrinks — the input
 * viewport is treated as a floor, so anchor content always stays visible.
 */
function clampViewportAspect(viewport: ViewportBounds): ViewportBounds {
  const xSpan = viewport.xMax - viewport.xMin
  const ySpan = viewport.yMax - viewport.yMin
  if (xSpan <= 0 || ySpan <= 0) return viewport

  if (ySpan > xSpan * MAX_VIEWPORT_ASPECT) {
    // Too tall — grow x symmetrically around the current x-center.
    const neededXSpan = ySpan / MAX_VIEWPORT_ASPECT
    const extra = (neededXSpan - xSpan) / 2
    return {
      ...viewport,
      xMin: viewport.xMin - extra,
      xMax: viewport.xMax + extra,
    }
  }
  if (xSpan > ySpan * MAX_VIEWPORT_ASPECT) {
    // Too wide — grow y symmetrically around the current y-center.
    const neededYSpan = xSpan / MAX_VIEWPORT_ASPECT
    const extra = (neededYSpan - ySpan) / 2
    return {
      ...viewport,
      yMin: viewport.yMin - extra,
      yMax: viewport.yMax + extra,
    }
  }
  return viewport
}

/**
 * Resolve the final viewport based on mode
 * Returns auto-calculated viewport for 'auto' mode, or manual values for 'manual' mode
 */
export function resolveViewport(spec: AxisSpecV1): ViewportBounds {
  // Check if manual mode is enabled and has complete viewport values
  const isManualMode = spec.viewportMode === 'manual'
  const hasCompleteViewport =
    spec.viewport?.xMin !== undefined &&
    spec.viewport?.xMax !== undefined &&
    spec.viewport?.yMin !== undefined &&
    spec.viewport?.yMax !== undefined

  if (isManualMode && hasCompleteViewport) {
    const manual: ViewportBounds = {
      xMin: spec.viewport!.xMin!,
      xMax: spec.viewport!.xMax!,
      yMin: spec.viewport!.yMin!,
      yMax: spec.viewport!.yMax!,
    }
    // Honor the author's range as entered — no tightening toward anchor
    // content. Import-time baking (`withFeaturePointViewport`) already
    // fits generated viewports; tightening here silently overrode ranges
    // admins set on purpose (e.g. extending x past the origin).
    // Skip aspect clamp when the spec is empty — the author's declared
    // viewport is the only signal we have about what they want to show.
    return hasAnyRenderableContent(spec) ? clampViewportAspect(manual) : manual
  }

  // Auto path: clamp when there's content; otherwise `calculateAutoViewport`
  // already returned DEFAULT_BOUNDS which is a safe 1:1 ratio.
  const auto = calculateAutoViewport(spec)
  return hasAnyRenderableContent(spec) ? clampViewportAspect(auto) : auto
}
