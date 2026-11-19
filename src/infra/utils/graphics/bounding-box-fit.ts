/**
 * @fileType utility
 * @domain graphics
 * @pattern bounding-box-fit
 * @ai-summary Pad a JSXGraph bounding box so its aspect ratio matches the
 *             board's pixel size, giving equal x/y units (circles stay round).
 */

export type BoundingBox = [number, number, number, number]

/**
 * JSXGraph stretches the bounding box `[xMin, yMax, xMax, yMin]` to fill the
 * board, so any mismatch between the box's shape and the board's pixel size
 * scales x and y differently. Widen the short side (equally on both ends) so
 * the whole original box stays visible and one unit is the same length on
 * both axes.
 */
export function fitBoundingBoxToBoard(
  boundingBox: BoundingBox,
  width: number,
  height: number,
): BoundingBox {
  const [xMin, yMax, xMax, yMin] = boundingBox
  const xRange = xMax - xMin
  const yRange = yMax - yMin
  const usable = width > 0 && height > 0 && Number.isFinite(xRange) && Number.isFinite(yRange)
  if (!usable || xRange <= 0 || yRange <= 0) return boundingBox

  const pxPerUnit = Math.min(width / xRange, height / yRange)
  const padX = (width / pxPerUnit - xRange) / 2
  const padY = (height / pxPerUnit - yRange) / 2
  return [xMin - padX, yMax + padY, xMax + padX, yMin - padY]
}
