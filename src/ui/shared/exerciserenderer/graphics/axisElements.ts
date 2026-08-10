import { parse as parseMath } from 'mathjs'

import type { AxisSpecV1 } from '@/infra/contracts'
import { getDefaultTextColor } from '@/infra/contracts/graphics/textColors'
import { parseMathExpression } from '../utils/safeMathEval'

type GraphSpec = AxisSpecV1['elements']['graphs'][number]
type PointSpec = AxisSpecV1['elements']['points'][number]
type LocusSpec = NonNullable<AxisSpecV1['elements']['geometricLoci']>[number]

function renderGraphs(
  board: JXG.Board,
  graphs: GraphSpec[],
  viewport: AxisSpecV1['viewport'],
): void {
  for (const graph of graphs) {
    const parsed = parseMathExpression(graph.fn)
    if (!parsed.valid) continue

    const attrs: Record<string, unknown> = {
      strokeWidth: graph.thickness,
      dash: graph.style === 'dashed' ? 2 : 0,
    }
    if (graph.color) attrs.strokeColor = graph.color

    // Always clip to domain or viewport — prevents polynomial explosion outside visible range
    const rangeFrom = graph.range?.fromX ?? viewport?.xMin ?? -5
    const rangeTo = graph.range?.toX ?? viewport?.xMax ?? 5

    board.create('functiongraph', [parsed.evaluate, rangeFrom, rangeTo], attrs)
  }
}

function renderAxisPoints(board: JXG.Board, points: PointSpec[]) {
  for (const p of points) {
    if (p.type === 'floating_text') {
      board.create('text', [p.x, p.y, p.label || ''], {
        fontSize: 14,
        anchorX: 'middle',
        anchorY: 'middle',
        fontFamily: 'Times New Roman',
      })
    } else {
      const attrs: Record<string, unknown> = {
        name: p.label || '',
        fixed: true,
        size: 4,
        withLabel: !!p.label,
      }
      if (p.color) {
        attrs.strokeColor = p.color
        attrs.fillColor = p.type === 'hole' ? '#ffffff' : p.color
      } else {
        attrs.fillColor = p.type === 'hole' ? '#ffffff' : getDefaultTextColor()
      }
      if (p.type === 'hole') {
        attrs.strokeWidth = 2
      }

      board.create('point', [p.x, p.y], attrs)
    }
  }
}

function renderVerticalAsymptotes(board: JXG.Board, values: number[]) {
  for (const x of values) {
    board.create(
      'line',
      [
        [x, 0],
        [x, 1],
      ],
      {
        dash: 3,
        strokeColor: '#999',
        strokeWidth: 1,
        straightFirst: true,
        straightLast: true,
        fixed: true,
      },
    )
  }
}

function renderHorizontalAsymptotes(board: JXG.Board, values: number[]) {
  for (const y of values) {
    board.create(
      'line',
      [
        [0, y],
        [1, y],
      ],
      {
        dash: 3,
        strokeColor: '#999',
        strokeWidth: 1,
        straightFirst: true,
        straightLast: true,
        fixed: true,
      },
    )
  }
}

function renderLineBetweenPoints(
  board: JXG.Board,
  lines: NonNullable<AxisSpecV1['elements']['lineBetweenPoints']>,
) {
  for (const line of lines) {
    const attrs: Record<string, unknown> = {
      strokeWidth: line.thickness,
      dash: line.style === 'dashed' ? 2 : 0,
      straightFirst: false,
      straightLast: false,
    }
    if (line.color) attrs.strokeColor = line.color
    board.create(
      'segment',
      [
        [line.a.x, line.a.y],
        [line.b.x, line.b.y],
      ],
      attrs,
    )
  }
}

/**
 * Compile an implicit equation `LHS = RHS` into a `(x, y) => number` function
 * that returns zero on the curve. Used as the fallback for geometricLoci that
 * aren't trivial vertical/horizontal lines.
 */
function compileImplicit(equation: string): ((x: number, y: number) => number) | null {
  const eq = equation.trim()
  const eqIndex = eq.indexOf('=')
  if (eqIndex < 0) return null
  const lhs = eq.slice(0, eqIndex).trim()
  const rhs = eq.slice(eqIndex + 1).trim()
  if (!lhs || !rhs) return null
  try {
    const compiled = parseMath(`(${lhs}) - (${rhs})`).compile()
    const scope = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      sqrt: Math.sqrt,
      abs: Math.abs,
      log: Math.log,
      exp: Math.exp,
      PI: Math.PI,
      E: Math.E,
    }
    return (x: number, y: number) => {
      try {
        const r = compiled.evaluate({ ...scope, x, y })
        return typeof r === 'number' ? r : NaN
      } catch {
        return NaN
      }
    }
  } catch {
    return null
  }
}

function dashFromStyle(style: LocusSpec['style']): number {
  // JSXGraph dash levels: 0 (solid), 1 (small dots), 2 (dashes), 3 (mixed).
  if (style === 'dashed') return 2
  if (style === 'dotted') return 1
  return 0
}

/**
 * Detect the curriculum team's most common non-linear locus: an origin- or
 * point-centered circle, `x^2 + y^2 = r^2` (optionally with (x-a)^2 / (y-b)^2
 * shifts). Falling through to JSXGraph's marching-squares implicit renderer
 * for circles was silently producing empty output in some builds — a proper
 * `board.create('circle', ...)` is more reliable and looks crisper.
 *
 * Returns { cx, cy, r } if the equation matches, otherwise null.
 */
function tryParseCircle(equation: string): { cx: number; cy: number; r: number } | null {
  const eq = equation.replace(/\s+/g, '').toLowerCase()
  // x^2+y^2=r_squared, with optional (x-a)^2 / (y-b)^2 shifts
  const m = eq.match(
    /^(?:\(x([+-]\d+(?:\.\d+)?)\)|x)\^2\+(?:\(y([+-]\d+(?:\.\d+)?)\)|y)\^2=(-?\d+(?:\.\d+)?)$/,
  )
  if (!m) return null
  const [, xShift, yShift, rSquaredStr] = m
  const rSquared = Number(rSquaredStr)
  if (!Number.isFinite(rSquared) || rSquared <= 0) return null
  // `x - a` means center at +a; capture is `-a`, so cx = -capture.
  const cx = xShift ? -Number(xShift) : 0
  const cy = yShift ? -Number(yShift) : 0
  return { cx, cy, r: Math.sqrt(rSquared) }
}

/**
 * Create the JSXGraph primitive(s) for a single locus and return the created
 * element (or null on failure). Extracted so the admin canvas (which tracks
 * elements by id for incremental sync) can render loci with the exact same
 * fast paths and fallback as the published exercise renderer.
 */
export function createLocusOnBoard(
  board: JXG.Board,
  locus: LocusSpec,
): JXG.GeometryElement | null {
  const attrs: Record<string, unknown> = {
    strokeWidth: locus.thickness,
    dash: dashFromStyle(locus.style),
    fixed: true,
  }
  if (locus.color) attrs.strokeColor = locus.color

  const eq = locus.equation.replace(/\s+/g, '')

  // Fast paths — `$x=c$` / `$y=c$` are the overwhelmingly common curriculum
  // authoring shape (vertical/horizontal reference lines). Handling them as
  // proper JSXGraph `line` primitives is cheaper and looks crisper than
  // routing them through the implicit-curve marching-squares path.
  const vert = eq.match(/^x=(-?\d+(?:\.\d+)?)$/)
  if (vert) {
    const x = Number(vert[1])
    return board.create(
      'line',
      [
        [x, 0],
        [x, 1],
      ],
      {
        ...attrs,
        straightFirst: true,
        straightLast: true,
      },
    ) as JXG.GeometryElement
  }
  const horz = eq.match(/^y=(-?\d+(?:\.\d+)?)$/)
  if (horz) {
    const y = Number(horz[1])
    return board.create(
      'line',
      [
        [0, y],
        [1, y],
      ],
      {
        ...attrs,
        straightFirst: true,
        straightLast: true,
      },
    ) as JXG.GeometryElement
  }

  const circle = tryParseCircle(locus.equation)
  if (circle) {
    return board.create('circle', [[circle.cx, circle.cy], circle.r], {
      ...attrs,
      fillColor: 'none',
    }) as JXG.GeometryElement
  }

  const fn = compileImplicit(locus.equation)
  if (!fn) {
    console.warn(`[AxisRenderer] Could not compile locus equation: ${locus.equation}`)
    return null
  }
  try {
    return board.create('implicitcurve', [fn], attrs) as JXG.GeometryElement
  } catch (err) {
    // Surface implicit-curve failures instead of swallowing them silently —
    // most "blank axis" reports trace back to a specific equation the
    // marching-squares renderer couldn't handle.
    console.error(`[AxisRenderer] implicitcurve failed for "${locus.equation}":`, err)
    return null
  }
}

function renderGeometricLoci(board: JXG.Board, loci: LocusSpec[]) {
  for (const locus of loci) {
    createLocusOnBoard(board, locus)
  }
}

/**
 * Render all axis elements from an AxisSpecV1 onto a JSXGraph board.
 */
export function renderAxisSpec(board: JXG.Board, spec: AxisSpecV1): void {
  renderGraphs(board, spec.elements.graphs, spec.viewport)
  renderAxisPoints(board, spec.elements.points)

  if (spec.elements.asymptotesVertical?.length) {
    renderVerticalAsymptotes(board, spec.elements.asymptotesVertical)
  }
  if (spec.elements.asymptotesHorizontal?.length) {
    renderHorizontalAsymptotes(board, spec.elements.asymptotesHorizontal)
  }
  if (spec.elements.lineBetweenPoints?.length) {
    renderLineBetweenPoints(board, spec.elements.lineBetweenPoints)
  }
  if (spec.elements.geometricLoci?.length) {
    renderGeometricLoci(board, spec.elements.geometricLoci)
  }
}
