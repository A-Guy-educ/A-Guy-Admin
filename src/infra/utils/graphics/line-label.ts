/**
 * Shared sizing for geometry segment labels so the admin editor canvas, the
 * exercise renderer and the SVG export all agree.
 */

const BASE_FONT_SIZE = 10
/** Labels render 25% larger than their stored/base font size. */
const FONT_SCALE = 1.25
/** Perpendicular gap from the segment, as a fraction of canvas height (was 0.03 — 30% closer). */
export const LINE_LABEL_OFFSET_RATIO = 0.021

export function lineLabelFontSize(stored?: number): number {
  return (stored || BASE_FONT_SIZE) * FONT_SCALE
}
