/**
 * Axis graphs always label every integer (1, 2, 3…). JSXGraph's default
 * `insertTicks: true` re-spaces ticks to 2/4/6 or 0.5/1/1.5 depending on the
 * zoom level, so it's pinned off here and the distance fixed at 1. Shared by
 * the admin editor board and the exercise renderer board so both match.
 */
export const AXIS_TICK_OPTIONS = {
  ticksDistance: 1,
  insertTicks: false,
  minorTicks: 0,
} as const

/** Grid lines on the same 1-unit step as the ticks (JSXGraph defaults to an auto step). */
export const AXIS_GRID_OPTIONS = {
  majorStep: [1, 1],
  minorElements: 0,
}
