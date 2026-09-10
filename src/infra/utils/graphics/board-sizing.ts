/**
 * @fileType utility
 * @domain graphics
 * @pattern board-sizing
 * @ai-summary Compute JSXGraph board pixel dimensions that match a
 *             mathematical viewport's aspect ratio so grid squares stay
 *             square and unit circles stay circular.
 */

export interface BoardSizeInput {
  /** Width of the mathematical viewport (xMax - xMin). */
  xRange: number
  /** Height of the mathematical viewport (yMax - yMin). */
  yRange: number
  /** Pixels available to lay the board out inside (parent width). */
  availableWidth: number
  /**
   * Ratio of x-unit pixel width to y-unit pixel width. `1` (default) means
   * one unit on x looks the same length as one unit on y. `2` makes x-units
   * twice as wide as y-units. Only meaningful for the graph block — geometry
   * always renders at 1:1.
   */
  proportion?: number
  /** Optional hard limits so the board doesn't grow past a sensible size. */
  maxWidth?: number
  maxHeight?: number
  minWidth?: number
  minHeight?: number
}

export interface BoardSize {
  width: number
  height: number
}

/**
 * Pick the pixel width/height for a JSXGraph container so its aspect ratio
 * matches the mathematical viewport (times an optional x/y proportion). The
 * board's boundingbox is passed through unchanged, so 1 x-unit and
 * `proportion` y-units end up the same visual length — grid squares stay
 * square and unit circles stay circular. Falls back to a square 400×400
 * when the viewport is degenerate.
 */
export function computeBoardSize(input: BoardSizeInput): BoardSize {
  const {
    xRange,
    yRange,
    availableWidth,
    proportion = 1,
    maxWidth = 600,
    maxHeight = 600,
    minWidth = 200,
    minHeight = 200,
  } = input

  if (!Number.isFinite(xRange) || !Number.isFinite(yRange) || xRange <= 0 || yRange <= 0) {
    const fallback = Math.max(minWidth, Math.min(maxWidth, availableWidth || 400))
    return { width: fallback, height: fallback }
  }

  const p = proportion > 0 && Number.isFinite(proportion) ? proportion : 1
  const desiredAspect = (xRange * p) / yRange // width / height

  let width = Math.min(availableWidth || maxWidth, maxWidth)
  let height = width / desiredAspect

  if (height > maxHeight) {
    height = maxHeight
    width = height * desiredAspect
  }

  if (width < minWidth) {
    width = minWidth
    height = width / desiredAspect
  }
  if (height < minHeight) {
    height = minHeight
    width = height * desiredAspect
  }

  // Final clamp. For extreme aspect ratios (e.g. an author-set viewport of
  // xRange=100, yRange=1) the min-height branch above can drive `width`
  // above `maxWidth` and overflow the caller's container — cap it here.
  if (width > maxWidth) {
    width = maxWidth
    height = width / desiredAspect
  }
  if (height > maxHeight) {
    height = maxHeight
    width = height * desiredAspect
  }

  return { width, height }
}
