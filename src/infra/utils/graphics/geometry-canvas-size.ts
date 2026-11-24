/**
 * @fileType utility
 * @domain graphics
 * @pattern geometry-canvas-size
 * @ai-summary Keep a geometry canvas's stored width/height consistent with how
 *             sketches really render: height fixed at 330, width = 330 × the
 *             bounding box's aspect ratio, and width edits grow the box.
 */

import { SKETCH_HEIGHT_PX } from './board-sizing'
import { fitBoundingBoxToBoard, type BoundingBox } from './bounding-box-fit'
import {
  computeContentBoundingBox,
  type ContentCircle,
  type ContentPoint,
} from './geometry-content-bounds'

export interface GeometryCanvasSize {
  width: number
  height: number
  boundingBox?: BoundingBox
}

/** Ratios wider than this (or narrower than its inverse) render small on Web. */
export const EXTREME_RATIO = 2

/** The box the renderer actually uses: explicit, or `[0, height, width, 0]`. */
export function resolveCanvasBox(canvas: GeometryCanvasSize): BoundingBox {
  return canvas.boundingBox ?? [0, canvas.height, canvas.width, 0]
}

/** xRange / yRange of a box, or null when either range is degenerate. */
export function boxAspectRatio(box: BoundingBox): number | null {
  const [xMin, yMax, xMax, yMin] = box
  const xRange = xMax - xMin
  const yRange = yMax - yMin
  if (!Number.isFinite(xRange) || !Number.isFinite(yRange) || xRange <= 0 || yRange <= 0) {
    return null
  }
  return xRange / yRange
}

/**
 * Width the sketch really renders at (before container clamps): 330 × the
 * box's aspect ratio. Stored `canvas.width` is ignored — it often disagrees
 * with the box. Falls back to the stored width for a degenerate box.
 */
export function deriveCanvasWidth(canvas: GeometryCanvasSize): number {
  const ratio = boxAspectRatio(resolveCanvasBox(canvas))
  return ratio === null ? canvas.width : Math.max(1, Math.round(SKETCH_HEIGHT_PX * ratio))
}

export function isExtremeRatio(ratio: number): boolean {
  return ratio > EXTREME_RATIO || ratio < 1 / EXTREME_RATIO
}

/** "2.7 : 1" for wide boxes, "1 : 1.5" for tall ones. */
export function formatAspectRatio(ratio: number): string {
  const fmt = (n: number) => String(Math.round(n * 10) / 10)
  return ratio >= 1 ? `${fmt(ratio)} : 1` : `1 : ${fmt(1 / ratio)}`
}

/**
 * Store the derived size: height 330, width from the box, and the box itself
 * materialized (so dropping the old height doesn't move the fallback box).
 * No visual change. Degenerate boxes are left untouched.
 */
export function normalizeGeometryCanvas<T extends GeometryCanvasSize>(canvas: T): T {
  const box = resolveCanvasBox(canvas)
  if (boxAspectRatio(box) === null) return canvas
  const width = deriveCanvasWidth(canvas)
  if (canvas.boundingBox && canvas.width === width && canvas.height === SKETCH_HEIGHT_PX) {
    return canvas
  }
  return { ...canvas, boundingBox: box, width, height: SKETCH_HEIGHT_PX }
}

/**
 * Author changed the width: target ratio = width / 330. Grow the short axis of
 * the box (centered) to that ratio — never crops content.
 */
export function applyCanvasWidth<T extends GeometryCanvasSize>(
  canvas: T,
  width: number,
): T & { boundingBox: BoundingBox } {
  const box = fitBoundingBoxToBoard(resolveCanvasBox(canvas), width, SKETCH_HEIGHT_PX)
  return { ...canvas, boundingBox: box, width: Math.round(width), height: SKETCH_HEIGHT_PX }
}

/** Replace the box and derive the width from it. */
export function applyCanvasBox<T extends GeometryCanvasSize>(canvas: T, box: BoundingBox): T {
  return normalizeGeometryCanvas({ ...canvas, boundingBox: box })
}

/**
 * "Fit to content": refit the box to the points + circles (10% padding), then
 * width = 330 × ratio. Unchanged when there are no usable points.
 */
export function fitCanvasToContent<T extends GeometryCanvasSize>(
  canvas: T,
  points: readonly ContentPoint[],
  circles: readonly ContentCircle[] = [],
): T {
  const box = computeContentBoundingBox(points, circles)
  return box ? applyCanvasBox(canvas, box) : canvas
}
