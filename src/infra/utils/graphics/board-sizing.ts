/**
 * @fileType utility
 * @domain graphics
 * @pattern board-sizing
 * @ai-summary Compute JSXGraph board pixel dimensions for existing sketch
 *             blocks: fixed height, aspect-driven width clamped to a
 *             container-relative range, with narrow-screen fallbacks.
 */

/**
 * Fixed render height for existing sketch blocks (axis + geometry).
 * Width is derived from the viewport aspect ratio and clamped to the
 * container-relative range below.
 */
export const SKETCH_HEIGHT_PX = 330

/**
 * Minimum rendered width. Narrower boards become unreadable on mobile
 * even if the viewport aspect would otherwise push below this.
 */
export const SKETCH_MIN_WIDTH_PX = 280

/**
 * Soft maximum: at most this fraction of the enclosing exercise container.
 * On narrow screens where this cap falls below the min width, we exceed
 * the cap to hit the min (see fallback below).
 */
export const SKETCH_MAX_CONTAINER_FRACTION = 0.75

export interface BoardSizeInput {
  /** Width of the mathematical viewport (xMax - xMin). */
  xRange: number
  /** Height of the mathematical viewport (yMax - yMin). */
  yRange: number
  /** Pixels available to lay the board out inside (exercise container width). */
  availableWidth: number
  /**
   * Ratio of x-unit pixel width to y-unit pixel width. `1` (default) means
   * one unit on x looks the same length as one unit on y. `2` makes x-units
   * twice as wide as y-units. Only meaningful for the graph block — geometry
   * always renders at 1:1.
   */
  proportion?: number
  /**
   * Explicit pixel width/height override — used for new-schema blocks
   * where the author picks dimensions directly instead of letting the
   * aspect ratio drive the width. The container clamp still applies
   * so an author-chosen width never overflows the screen.
   */
  widthOverride?: number
  heightOverride?: number
  /**
   * Hard cap on the rendered height (e.g. the chat view's mobile 275px).
   * When set on an existing block, the board keeps its true aspect ratio:
   * width = capped height × aspect, and if that overflows the container the
   * height shrinks with it. The min-width floor and 75% cap are skipped —
   * they belong to the uncapped 330px spec and would distort the ratio.
   */
  maxHeight?: number
  /**
   * Geometry only: when the width is clamped below the aspect-driven width,
   * shrink the height with it so the board keeps the viewport's shape
   * instead of squeezing x-units relative to y-units.
   */
  lockAspect?: boolean
}

export interface BoardSize {
  width: number
  height: number
}

/**
 * Pick the pixel width/height for a JSXGraph container.
 *
 * Spec (existing blocks):
 *   • Height is fixed at `SKETCH_HEIGHT_PX` (330).
 *   • Width = height × (xRange × proportion / yRange), clamped to
 *     `[SKETCH_MIN_WIDTH_PX, availableWidth × SKETCH_MAX_CONTAINER_FRACTION]`.
 *   • Narrow-screen fallbacks:
 *       - If 75% of the container is below the min width, allow exceeding
 *         75% and render at the min width.
 *       - If the container itself is below the min width, use the full
 *         container width (no horizontal scroll / no overflow).
 *
 * New-schema blocks (widthOverride / heightOverride set): use those directly,
 * only clamped so they never overflow the container width.
 */
export function computeBoardSize(input: BoardSizeInput): BoardSize {
  const {
    xRange,
    yRange,
    availableWidth,
    proportion = 1,
    widthOverride,
    heightOverride,
    maxHeight,
    lockAspect = false,
  } = input

  const hasMaxHeight = maxHeight !== undefined && Number.isFinite(maxHeight) && maxHeight > 0
  const baseHeight = heightOverride ?? SKETCH_HEIGHT_PX
  const height = hasMaxHeight ? Math.min(baseHeight, maxHeight) : baseHeight
  const container = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 0

  // New-schema path: author picked width/height. Still clamp width to the
  // container so a 500px-wide block on a 320px phone doesn't overflow.
  if (widthOverride !== undefined) {
    const w =
      container > 0 ? Math.min(Math.max(1, widthOverride), container) : Math.max(1, widthOverride)
    return { width: w, height }
  }

  // Aspect-driven width for existing blocks.
  const degenerate =
    !Number.isFinite(xRange) || !Number.isFinite(yRange) || xRange <= 0 || yRange <= 0
  const p = proportion > 0 && Number.isFinite(proportion) ? proportion : 1
  const naturalWidth = degenerate ? SKETCH_MIN_WIDTH_PX : height * ((xRange * p) / yRange)

  // Height-capped path: keep the aspect ratio exact, shrinking both sides
  // together when the natural width doesn't fit the container.
  if (hasMaxHeight && !degenerate) {
    if (container > 0 && naturalWidth > container) {
      return { width: container, height: (container * yRange) / (xRange * p) }
    }
    return { width: naturalWidth, height }
  }

  // Narrow-screen fallback #2: container narrower than the min width, just
  // use the container (no horizontal scroll). Spec says height stays 330.
  if (container > 0 && container < SKETCH_MIN_WIDTH_PX) {
    return withLockedAspect({ width: container, height }, naturalWidth, lockAspect && !degenerate)
  }

  // Normal path. If no container size was provided (SSR, zero-width render)
  // treat it as unbounded and let the natural width win so first paint
  // isn't a tiny strip.
  const effectiveMax =
    container > 0
      ? Math.max(SKETCH_MIN_WIDTH_PX, container * SKETCH_MAX_CONTAINER_FRACTION)
      : Infinity
  const width = Math.max(SKETCH_MIN_WIDTH_PX, Math.min(naturalWidth, effectiveMax))

  return withLockedAspect({ width, height }, naturalWidth, lockAspect && !degenerate)
}

/** Shrink the height by the same factor the width was clamped below its natural size. */
function withLockedAspect(size: BoardSize, naturalWidth: number, lock: boolean): BoardSize {
  if (!lock || size.width >= naturalWidth) return size
  return { width: size.width, height: (size.height * size.width) / naturalWidth }
}
