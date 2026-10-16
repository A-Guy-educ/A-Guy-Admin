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

  // Start from anchor bounds when they exist, otherwise defaults. Previously
  // we started from DEFAULT_BOUNDS unconditionally and used Math.min/max to
  // "expand" — but Math.min against a default of -10 means a point at x=5
  // yields xMin = -10, not 5. First-quadrant content ended up with a
  // -10..10 symmetric viewport, which looked like the renderer was
  // mirroring the axes.
  let xMin = anchor?.xMin ?? DEFAULT_BOUNDS.xMin
  let xMax = anchor?.xMax ?? DEFAULT_BOUNDS.xMax
  let yMin = anchor?.yMin ?? DEFAULT_BOUNDS.yMin
  let yMax = anchor?.yMax ?? DEFAULT_BOUNDS.yMax

  let hasContent = anchor !== null

  // Analyze graphs by sampling. We DO use the anchor's x-range when it
  // exists so a line through (0,0)–(5,5) doesn't drag y-samples at
  // x=-10/x=10 into the bounds. When no anchor is set we fall back to the
  // historical [-10, 10] sample window.
  const sampleCount = 20
  const sampleXMin = anchor?.xMin ?? -10
  const sampleXMax = anchor?.xMax ?? 10
  const sampleXSpan = sampleXMax - sampleXMin

  for (const graph of spec.elements.graphs) {
    hasContent = true
    for (let i = 0; i <= sampleCount; i++) {
      const x = sampleXMin + (i / sampleCount) * sampleXSpan
      const y = evaluateMathExpression(graph.fn, x)
      if (y !== null) {
        xMin = Math.min(xMin, x)
        xMax = Math.max(xMax, x)
        yMin = Math.min(yMin, y)
        yMax = Math.max(yMax, y)
      }
    }
  }

  if (!hasContent) {
    return DEFAULT_BOUNDS
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
 * Fraction of the manual viewport each dimension's anchor content must
 * fill to be considered "well fit". Anything less and the viewport is
 * mostly empty space on that axis — we tighten it to the anchor content
 * plus padding.
 *
 * The generator (parse-function-block-v2) tends to emit symmetric or
 * generously-wide ranges (e.g. `X Min: -6, X Max: 6, Y Min: -6, Y Max: 23`)
 * even when every point and line in the spec lives in the first quadrant.
 * Without this tightening, students see 60–80% empty space around the
 * content and the block renders as a thin strip because the pixel aspect
 * ratio follows the wasted viewport, not the content.
 */
const WASTE_THRESHOLD = 0.5
const TIGHTEN_PADDING_RATIO = 0.25

/**
 * Tighten a manual viewport toward anchor content (points + line endpoints
 * + explicit asymptotes) when content occupies less than WASTE_THRESHOLD
 * of the viewport span in a given dimension. Each axis is tightened
 * independently; axes that are already well-fit are left untouched.
 *
 * We only tighten based on *anchor* content, not on sampled graph values,
 * so an author who sets a wide X range specifically to show a function's
 * long-term behavior isn't contradicted — their intent is read from the
 * anchors they placed.
 */
function tightenManualViewport(spec: AxisSpecV1, manual: ViewportBounds): ViewportBounds {
  const anchor = collectAnchorBounds(spec)
  if (!anchor) return manual

  const xViewportSpan = manual.xMax - manual.xMin
  const yViewportSpan = manual.yMax - manual.yMin
  if (xViewportSpan <= 0 || yViewportSpan <= 0) return manual

  const xAnchorSpan = anchor.xMax - anchor.xMin
  const yAnchorSpan = anchor.yMax - anchor.yMin

  const xWasteful = xAnchorSpan / xViewportSpan < WASTE_THRESHOLD
  const yWasteful = yAnchorSpan / yViewportSpan < WASTE_THRESHOLD

  if (!xWasteful && !yWasteful) return manual

  // Minimum of 1 unit of padding so a near-degenerate anchor (two points
  // sharing an x or y) still renders with breathing room.
  const xPad = Math.max(1, xAnchorSpan * TIGHTEN_PADDING_RATIO)
  const yPad = Math.max(1, yAnchorSpan * TIGHTEN_PADDING_RATIO)

  // When tightening, pull each edge inward toward anchor+padding — but
  // never past the anchor (would clip content) and never outside the
  // manual bound (don't widen beyond author's choice on the other side).
  return {
    xMin: xWasteful ? Math.max(manual.xMin, anchor.xMin - xPad) : manual.xMin,
    xMax: xWasteful ? Math.min(manual.xMax, anchor.xMax + xPad) : manual.xMax,
    yMin: yWasteful ? Math.max(manual.yMin, anchor.yMin - yPad) : manual.yMin,
    yMax: yWasteful ? Math.min(manual.yMax, anchor.yMax + yPad) : manual.yMax,
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
 * viewport is treated as a floor, so anchor content stays visible even
 * if the aspect clamp fires after a tightening step.
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
    const tightened = tightenManualViewport(spec, manual)
    // Skip aspect clamp when the spec is empty — the author's declared
    // viewport is the only signal we have about what they want to show.
    return hasAnyRenderableContent(spec) ? clampViewportAspect(tightened) : tightened
  }

  // Auto path: clamp when there's content; otherwise `calculateAutoViewport`
  // already returned DEFAULT_BOUNDS which is a safe 1:1 ratio.
  const auto = calculateAutoViewport(spec)
  return hasAnyRenderableContent(spec) ? clampViewportAspect(auto) : auto
}
