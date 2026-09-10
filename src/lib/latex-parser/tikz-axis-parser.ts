/**
 * Parses TikZ \begin{axis}[...] environments into AxisSpecV1 blocks.
 *
 * Handles:
 * - \begin{axis}[xmin=..., xmax=..., ymin=..., ymax=...] for viewport
 * - \addplot[domain=a:b, ...] {expression} for function graphs
 * - \addplot[only marks] coordinates {(x,y)...} for scatter points
 * - \addplot[fill=...] {expression} \closedcycle for paint/fill areas
 * - \draw[dashed] (axis cs:...) -- (axis cs:...) for asymptotes
 * - \node at (axis cs:...) {text} for floating text labels
 * - \draw [domain=a:b] plot (\x, {expression}) for raw TikZ function plots
 */

import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { QuestionAxisBlock } from '@/server/payload/collections/Exercises/types'
import { makeAxisBlock } from '@/lib/latex-parser/block-generators'
import { generateId } from '@/server/payload/collections/Exercises/types'

/**
 * Standard TikZ / pgfplots color names → hex. Covers the colors the author
 * uses across worksheets (winered/LogoGreen from their `\definecolor` set) as
 * well as the built-in TikZ palette. Kept as an inline map because the
 * `\definecolor` definitions live in the LaTeX preamble which is stripped
 * before the tikz parser ever sees the source.
 */
const KNOWN_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#00c000',
  blue: '#0000ff',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gray: '#808080',
  grey: '#808080',
  darkgray: '#404040',
  lightgray: '#c0c0c0',
  // Author custom colors — mirrors `\definecolor{winered}{RGB}{153,0,0}` etc.
  winered: '#990000',
  logogreen: '#556b4f',
  logored: '#990000',
}

/**
 * Resolve a TikZ color option (`color=winered`, `blue`, `LogoGreen`, `!50!red`
 * variants…) to a hex string. Case-insensitive lookup so `LogoGreen` /
 * `logogreen` both resolve. Returns undefined for unrecognized names so the
 * downstream schema falls back to its default.
 */
function resolveColor(raw: string | undefined, extra?: Map<string, string>): string | undefined {
  if (!raw) return undefined
  const name = raw.split('!')[0].trim().toLowerCase()
  if (!name) return undefined
  if (extra?.has(name)) return extra.get(name)
  return KNOWN_COLORS[name]
}

/**
 * Map TikZ node position keywords (`above`, `below`, `below left`, …) to the
 * axis schema's `labelPosition` compass short-code (`t`, `b`, `bl`, …).
 * Whitespace between the two words is optional so `above right` and
 * `aboveright` both resolve. Returns undefined for unrecognised strings so
 * the schema falls back to its default.
 */
type LabelPosition = 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l' | 'tl' | 'm'

function resolveTikzLabelPosition(optionStr: string | undefined): LabelPosition | undefined {
  if (!optionStr) return undefined
  const normalized = optionStr.toLowerCase().replace(/\s+/g, ' ').trim()
  // Composite keys first (order-independent).
  if (/(above\s+right|right\s+above)/.test(normalized)) return 'tr'
  if (/(above\s+left|left\s+above)/.test(normalized)) return 'tl'
  if (/(below\s+right|right\s+below)/.test(normalized)) return 'br'
  if (/(below\s+left|left\s+below)/.test(normalized)) return 'bl'
  if (/(^|\W)above(\W|$)/.test(normalized)) return 't'
  if (/(^|\W)below(\W|$)/.test(normalized)) return 'b'
  if (/(^|\W)left(\W|$)/.test(normalized)) return 'l'
  if (/(^|\W)right(\W|$)/.test(normalized)) return 'r'
  if (/(^|\W)(center|centered)(\W|$)/.test(normalized)) return 'm'
  return undefined
}

/** Parse key=value options from [key=val, key2=val2], respecting brace groups */
function parseOptions(optionStr: string): Record<string, string> {
  const opts: Record<string, string> = {}
  // Split on commas that are NOT inside braces
  const pairs: string[] = []
  let current = ''
  let braceDepth = 0
  for (const ch of optionStr) {
    if (ch === '{') braceDepth++
    else if (ch === '}') braceDepth--
    if (ch === ',' && braceDepth === 0) {
      pairs.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) pairs.push(current)

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx !== -1) {
      const key = pair.slice(0, eqIdx).trim()
      const val = pair.slice(eqIdx + 1).trim()
      opts[key] = val
    } else {
      const trimmed = pair.trim()
      if (trimmed) opts[trimmed] = 'true'
    }
  }
  return opts
}

/**
 * Expand pgfplots convenience functions into plain math the client-side
 * plotter can render. pgfplots provides `gauss(mu, sigma)` which pgfplots
 * itself resolves to the normal PDF; we translate to a form the mathjs-based
 * safeMathEval accepts AND that has a peak large enough to be visible on the
 * default -5..5 viewport.
 *
 * The literal normal PDF `(1/(sigma*sqrt(2*pi))) * exp(...)` peaks at ~0.4/sigma
 * — for gauss(12, 2) that's 0.2 on a -5..5 range, i.e. an invisible flat line.
 * The author's own workaround was `2.71^(-((x-mu)/sigma)^2) / sigma * 2.51`,
 * which peaks at 2.51/sigma (visible) and matches the bell-shape they expect.
 * We use the same pattern so their gauss curves render.
 */
function expandPgfplotsFns(expr: string): string {
  return expr.replace(
    /gauss\s*\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/g,
    (_, mu: string, sigma: string) => `(2.51/(${sigma}))*2.71^(-(((x-(${mu}))/(${sigma}))^2))`,
  )
}

/** Convert LaTeX math expression to a simpler function string */
function latexToFnString(latex: string): string {
  return expandPgfplotsFns(
    latex
      .replace(/\\cdot/g, '*')
      .replace(/\\\*/g, '*')
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
      .replace(/\\left\(/g, '(')
      .replace(/\\right\)/g, ')')
      .replace(/\^(\d+)/g, '^$1')
      .replace(/\{([^}]+)\}/g, '($1)')
      .trim(),
  )
}

/** Parse \addplot commands from tikzpicture content */
function parseAddPlots(content: string): {
  graphs: AxisSpecV1['elements']['graphs']
  points: AxisSpecV1['elements']['points']
  fillRanges: Array<{ fn: string; fromX: number; toX: number }>
} {
  const graphs: AxisSpecV1['elements']['graphs'] = []
  const points: AxisSpecV1['elements']['points'] = []
  const fillRanges: Array<{ fn: string; fromX: number; toX: number }> = []

  // Match \addplot[options] {expression} or \addplot[options] expression;
  const plotRegex = /\\addplot\s*\[([^\]]*)\]\s*\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = plotRegex.exec(content)) !== null) {
    const opts = parseOptions(match[1])
    const expr = match[2]

    if (opts['fill'] || opts['draw'] === 'none') {
      // Area fill — extract as paint range
      if (opts['domain']) {
        const [from, to] = opts['domain'].split(':').map(Number)
        if (!isNaN(from) && !isNaN(to)) {
          fillRanges.push({ fn: latexToFnString(expr), fromX: from, toX: to })
        }
      }
      continue
    }

    const style = opts['dashed'] ? 'dashed' : ('solid' as const)
    const thickness = opts['thick'] ? 2 : 1
    const range: { fromX?: number | null; toX?: number | null } = {}

    if (opts['domain']) {
      const [from, to] = opts['domain'].split(':').map(Number)
      if (!isNaN(from)) range.fromX = from
      if (!isNaN(to)) range.toX = to
    }

    // TikZ color option supports both `color=name` and bare `name` — pgfplots
    // accepts the color name as a standalone option key. Prefer the explicit
    // `color=` form, then look for any known-color bare key.
    const optColor =
      opts['color'] ??
      Object.keys(opts).find((k) => opts[k] === 'true' && resolveColor(k) !== undefined)
    const color = resolveColor(optColor)

    // Omit `range` entirely when empty rather than setting it to `undefined` —
    // the axis schema rejects null, and undefined round-trips as null through
    // the block-content serialization path.
    graphs.push({
      id: generateId(),
      fn: latexToFnString(expr),
      style,
      thickness,
      ...(Object.keys(range).length > 0 ? { range } : {}),
      ...(color ? { color } : {}),
    })
  }

  // Match \addplot[only marks] coordinates {(x1,y1) (x2,y2) ...}
  const coordRegex = /\\addplot\s*\[([^\]]*only\s+marks[^\]]*)\]\s*coordinates\s*\{([^}]+)\}/g
  while ((match = coordRegex.exec(content)) !== null) {
    const coordStr = match[2]
    const coordPairs = coordStr.match(/\(([^)]+)\)/g)
    if (coordPairs) {
      for (const pair of coordPairs) {
        const nums = pair.replace(/[()]/g, '').split(',').map(Number)
        if (nums.length === 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
          points.push({ x: nums[0], y: nums[1], type: 'point' as const })
        }
      }
    }
  }

  return { graphs, points, fillRanges }
}

/**
 * Parse \draw ... plot (\x, {expression}); commands from raw TikZ
 * (outside \begin{axis} environments, e.g. exercise 8)
 */
function parseDrawPlots(content: string): {
  graphs: AxisSpecV1['elements']['graphs']
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number }
} {
  const graphs: AxisSpecV1['elements']['graphs'] = []
  let globalXMin = Infinity
  let globalXMax = -Infinity

  // Match \draw [options] plot (\x, {expression});
  const drawPlotRegex = /\\draw\s*\[([^\]]*)\]\s*plot\s*\(\\x\s*,\s*\{([^}]+)\}\s*\)\s*;/g
  let match: RegExpExecArray | null
  while ((match = drawPlotRegex.exec(content)) !== null) {
    const opts = parseOptions(match[1])
    const rawExpr = match[2]

    // Convert \x to x in the expression
    const expr = latexToFnString(rawExpr.replace(/\\x/g, 'x'))
    const style = opts['dashed'] ? 'dashed' : ('solid' as const)
    const thickness = opts['thick'] ? 2 : 1
    const range: { fromX?: number | null; toX?: number | null } = {}

    if (opts['domain']) {
      const [from, to] = opts['domain'].split(':').map(Number)
      if (!isNaN(from)) {
        range.fromX = from
        globalXMin = Math.min(globalXMin, from)
      }
      if (!isNaN(to)) {
        range.toX = to
        globalXMax = Math.max(globalXMax, to)
      }
    }

    graphs.push({
      id: generateId(),
      fn: expr,
      style,
      thickness,
      ...(Object.keys(range).length > 0 ? { range } : {}),
    })
  }

  // Infer viewport from axis lines: \draw[-latex] (xmin,0) -- (xmax,0)
  const xAxisMatch = /\\draw\s*\[-?(?:latex|>)\]\s*\(([^,]+),\s*0\)\s*--\s*\(([^,]+),\s*0\)/.exec(
    content,
  )
  const yAxisMatch = /\\draw\s*\[-?(?:latex|>)\]\s*\(0,\s*([^)]+)\)\s*--\s*\(0,\s*([^)]+)\)/.exec(
    content,
  )

  const xMin = xAxisMatch ? parseFloat(xAxisMatch[1]) : globalXMin !== Infinity ? globalXMin : -10
  const xMax = xAxisMatch ? parseFloat(xAxisMatch[2]) : globalXMax !== -Infinity ? globalXMax : 10
  const yMin = yAxisMatch ? parseFloat(yAxisMatch[1]) : -10
  const yMax = yAxisMatch ? parseFloat(yAxisMatch[2]) : 10

  return { graphs, viewport: { xMin, xMax, yMin, yMax } }
}

/**
 * Parse \draw[dashed] (axis cs:X1,Y1) -- (axis cs:X2,Y2) lines inside axis environments.
 * Detects vertical and horizontal asymptotes.
 */
function parseAsymptotes(content: string): {
  vertical: number[]
  horizontal: number[]
} {
  const vertical: number[] = []
  const horizontal: number[] = []

  // Match \draw[dashed] (axis cs:X1,Y1) -- (axis cs:X2,Y2);
  const drawRegex =
    /\\draw\s*\[([^\]]*dashed[^\]]*)\]\s*\(axis\s+cs:\s*([^,]+),\s*([^)]+)\)\s*--\s*\(axis\s+cs:\s*([^,]+),\s*([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = drawRegex.exec(content)) !== null) {
    const x1 = parseFloat(match[2])
    const y1 = parseFloat(match[3])
    const x2 = parseFloat(match[4])
    const y2 = parseFloat(match[5])

    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) continue

    // Vertical asymptote: same X, different Y
    if (Math.abs(x1 - x2) < 0.001) {
      vertical.push(x1)
    }
    // Horizontal asymptote: same Y, different X
    if (Math.abs(y1 - y2) < 0.001) {
      horizontal.push(y1)
    }
  }

  return { vertical, horizontal }
}

/**
 * Clean tikz node label text before rendering as a plain string. The axis /
 * geometry renderers draw labels as text (not math), so LaTeX commands, math
 * delimiters, and sizing/color macros must be stripped or unwrapped first —
 * otherwise labels display as `\small f(x)` / `\textbf{A}` / `$x$`.
 */
export function cleanNodeLabel(raw: string): string {
  return raw
    .replace(/\\textcolor\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\{\s*\\color\{[^}]*\}\s*([^{}]*)\}/g, '$1')
    .replace(/\\color\{[^}]*\}\s*/g, '')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\\(?:Large|large|huge|Huge|LARGE|normalsize|small|footnotesize|tiny)\s*/g, '')
    .replace(/\$/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

/**
 * Parse `\fill[options] (axis cs: X, Y) circle (Xpt) node[pos] {label};` —
 * the standard pgfplots pattern for placing a labeled data point on an axis
 * (e.g., `\fill[color=black] (axis cs: -1, 0) circle (2pt) node[above left] {$A$};`).
 * Emitted by the author's PDF worksheets throughout — without this, all the
 * labeled points on `\begin{axis}` diagrams get dropped.
 */
function parseAxisFillPoints(
  content: string,
  colorMap: Map<string, string>,
): AxisSpecV1['elements']['points'] {
  const out: AxisSpecV1['elements']['points'] = []
  // `\fill[opts] (axis cs: X, Y) circle (Xpt) node[pos] {label}` — options
  // optional, node label allows one level of nested braces so `{$A$}` and
  // `{${\color{winered} A}$}` both capture cleanly.
  const re =
    /\\fill\s*(?:\[([^\]]*)\])?\s*\(\s*axis\s+cs:\s*([^,]+),\s*([^)]+)\)\s*circle\s*\(\s*[\d.]+\s*pt\s*\)\s*node\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const fillOpts = parseOptions(m[1] ?? '')
    const x = parseFloat(m[2])
    const y = parseFloat(m[3])
    const nodeOpts = m[4] ?? ''
    const label = cleanNodeLabel(m[5])
    if (isNaN(x) || isNaN(y)) continue
    const color = resolveColor(fillOpts['color'], colorMap)
    const labelPosition = resolveTikzLabelPosition(nodeOpts)
    out.push({
      x,
      y,
      type: 'point' as const,
      ...(label ? { label } : {}),
      ...(color ? { color } : {}),
      ...(labelPosition ? { labelPosition } : {}),
    })
  }
  return out
}

/**
 * Parse \node at (axis cs:X,Y) {...} for text labels and point markers.
 */
function parseAxisNodes(content: string): AxisSpecV1['elements']['points'] {
  const nodePoints: AxisSpecV1['elements']['points'] = []

  // Match \node at (axis cs:X,Y) [options] {text};  OR  \node at (axis cs:X,Y) {text};
  // Label capture allows one level of nested braces so `{${\color{winered} X}$}`
  // captures the whole `${\color{winered} X}$`, not just `${\color{winered`.
  const nodeRegex =
    /\\node\s*(?:\[([^\]]*)\])?\s*at\s*\(axis\s+cs:\s*([^,]+),\s*([^)]+)\)\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let match: RegExpExecArray | null
  while ((match = nodeRegex.exec(content)) !== null) {
    const beforeOpts = match[1] ?? ''
    const x = parseFloat(match[2])
    const y = parseFloat(match[3])
    const afterOpts = match[4] ?? ''
    const text = cleanNodeLabel(match[5])

    if (isNaN(x) || isNaN(y)) continue

    const allOpts = `${beforeOpts} ${afterOpts}`
    const labelPosition = resolveTikzLabelPosition(allOpts)

    // Node with circle,fill → point marker (no label)
    if (allOpts.includes('circle') && allOpts.includes('fill')) {
      nodePoints.push({
        x,
        y,
        type: 'point' as const,
        ...(labelPosition ? { labelPosition } : {}),
      })
    } else if (text) {
      // Node with text → floating text label
      nodePoints.push({
        x,
        y,
        type: 'floating_text' as const,
        label: text,
        ...(labelPosition ? { labelPosition } : {}),
      })
    }
  }

  return nodePoints
}

/** Parse axis options [xmin=..., xmax=..., ...] */
function parseAxisOptions(content: string): {
  viewport: { xMin?: number; xMax?: number; yMin?: number; yMax?: number }
  labels: { x: string; y: string }
  showGrid: boolean
  showNumbers: boolean
  ticks: number[]
} {
  const axisOptsMatch = /\\begin\{axis\}\s*\[([^\]]*)\]/s.exec(content)
  const opts = axisOptsMatch ? parseOptions(axisOptsMatch[1]) : {}

  const viewport: { xMin?: number; xMax?: number; yMin?: number; yMax?: number } = {}
  if (opts['xmin']) viewport.xMin = parseFloat(opts['xmin'])
  if (opts['xmax']) viewport.xMax = parseFloat(opts['xmax'])
  if (opts['ymin']) viewport.yMin = parseFloat(opts['ymin'])
  if (opts['ymax']) viewport.yMax = parseFloat(opts['ymax'])
  // pgfplots' `domain=a:b` on `\begin{axis}[...]` sets the default x range
  // that every \addplot inherits. Treat it as the x viewport when explicit
  // xmin/xmax aren't given — otherwise files that rely on `domain=` (common
  // in the author's distribution plots) fall back to a hardcoded ±5 range
  // and the actual curve is drawn entirely off-screen.
  if (opts['domain'] && (viewport.xMin === undefined || viewport.xMax === undefined)) {
    const [from, to] = opts['domain'].split(':').map((n) => parseFloat(n))
    if (viewport.xMin === undefined && !isNaN(from)) viewport.xMin = from
    if (viewport.xMax === undefined && !isNaN(to)) viewport.xMax = to
  }

  const xlabel = opts['xlabel']?.replace(/[{}$]/g, '') ?? 'x'
  const ylabel = opts['ylabel']?.replace(/[{}$]/g, '') ?? 'y'
  const showGrid = opts['grid'] === 'major' || opts['grid'] === 'both'
  const showNumbers = opts['ticks'] !== 'none'

  // Parse xtick values
  const ticks: number[] = []
  if (opts['xtick']) {
    const tickStr = opts['xtick'].replace(/[{}]/g, '')
    tickStr.split(',').forEach((t) => {
      const n = parseFloat(t.trim())
      if (!isNaN(n)) ticks.push(n)
    })
  }

  return { viewport, labels: { x: xlabel, y: ylabel }, showGrid, showNumbers, ticks }
}

/**
 * Attach fill ranges as paint.underGraph on matching graphs.
 * Matches fill ranges to graphs by comparing function strings.
 */
function attachFillAreas(
  graphs: AxisSpecV1['elements']['graphs'],
  fillRanges: Array<{ fn: string; fromX: number; toX: number }>,
): void {
  for (const fill of fillRanges) {
    // Find the graph with the same function
    const target = graphs.find((g) => g.fn === fill.fn)
    if (target) {
      if (!target.paint) target.paint = {}
      if (!target.paint.underGraph) target.paint.underGraph = []
      target.paint.underGraph.push({ fromX: fill.fromX, toX: fill.toX })
    }
  }
}

/**
 * Attempts to parse a tikzpicture containing an axis environment
 * into a QuestionAxisBlock. Returns null if no axis found.
 */
export function parseTikzAxis(tikzContent: string): QuestionAxisBlock | null {
  if (!tikzContent.includes('\\begin{axis}')) return null

  const {
    viewport,
    labels,
    showGrid,
    showNumbers,
    ticks: tickValues,
  } = parseAxisOptions(tikzContent)
  const { graphs, points, fillRanges } = parseAddPlots(tikzContent)
  const asymptotes = parseAsymptotes(tikzContent)
  const nodePoints = parseAxisNodes(tikzContent)
  // `\fill[color=black] (axis cs: X, Y) circle (Xpt) node[pos] {$A$}` — the
  // standard way to mark labeled data points inside `\begin{axis}` blocks.
  const fillPoints = parseAxisFillPoints(tikzContent, new Map())

  const allPoints = [...points, ...nodePoints, ...fillPoints]

  if (graphs.length === 0 && allPoints.length === 0) return null

  // Attach fill areas to matching graphs
  if (fillRanges.length > 0) {
    attachFillAreas(graphs, fillRanges)
  }

  const xMin = viewport.xMin ?? -5
  const xMax = viewport.xMax ?? 5
  const yMin = viewport.yMin ?? -5
  const yMax = viewport.yMax ?? 5

  // Derive tick interval from parsed xtick values, or infer from viewport range
  let tickInterval = 1
  if (tickValues.length >= 2) {
    tickInterval = Math.abs(tickValues[1] - tickValues[0])
  } else {
    // Auto-derive a reasonable interval when no xtick specified
    const range = Math.max(xMax - xMin, yMax - yMin)
    if (range > 50) tickInterval = 10
    else if (range > 20) tickInterval = 5
    else if (range > 10) tickInterval = 2
  }

  const axis: AxisSpecV1 = {
    kind: 'cartesian',
    units: 1,
    viewportMode: 'manual',
    grid: { enabled: showGrid },
    axes: {
      showNumbers,
      showLabels: showNumbers,
      ticks: tickInterval,
      labels,
      origin: { x: 0, y: 0 },
    },
    viewport: { xMin, xMax, yMin, yMax },
    elements: {
      points: allPoints,
      graphs,
      ...(asymptotes.vertical.length > 0 && { asymptotesVertical: asymptotes.vertical }),
      ...(asymptotes.horizontal.length > 0 && { asymptotesHorizontal: asymptotes.horizontal }),
    },
  }

  return makeAxisBlock('', axis)
}

/**
 * Attempts to parse a tikzpicture with raw \draw ... plot commands
 * (without \begin{axis}) into a QuestionAxisBlock.
 * Returns null if no plot commands found.
 */
export function parseTikzDrawPlot(tikzContent: string): QuestionAxisBlock | null {
  // Only handle content without \begin{axis} (that's handled by parseTikzAxis)
  if (tikzContent.includes('\\begin{axis}')) return null

  const { graphs, viewport } = parseDrawPlots(tikzContent)
  if (graphs.length === 0) return null

  // Parse any coordinate-based points referenced in the TikZ
  const coordPoints: AxisSpecV1['elements']['points'] = []
  // Capture node[pos] options so the label renders beside the dot, not
  // overlapping it.
  const fillRegex =
    /\\fill\s*\((\w+)\)\s*circle\s*\([^)]+\)\s*node\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  const coordRegex = /\\coordinate\s*\((\w+)\)\s*at\s*\(([^)]+)\)/g
  const coordMap = new Map<string, { x: number; y: number }>()

  let match: RegExpExecArray | null
  while ((match = coordRegex.exec(tikzContent)) !== null) {
    const coords = match[2].split(',').map((s) => parseFloat(s.trim()))
    if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
      coordMap.set(match[1], { x: coords[0], y: coords[1] })
    }
  }

  while ((match = fillRegex.exec(tikzContent)) !== null) {
    const name = match[1]
    const nodeOpts = match[2] ?? ''
    const label = match[3].replace(/\$/g, '').trim()
    const coord = coordMap.get(name)
    if (coord) {
      const labelPosition = resolveTikzLabelPosition(nodeOpts)
      coordPoints.push({
        x: coord.x,
        y: coord.y,
        type: 'point' as const,
        label: label || name,
        ...(labelPosition ? { labelPosition } : {}),
      })
    }
  }

  const axis: AxisSpecV1 = {
    kind: 'cartesian',
    units: 1,
    viewportMode: 'manual',
    grid: { enabled: false },
    axes: {
      showNumbers: true,
      showLabels: true,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    viewport,
    elements: {
      points: coordPoints,
      graphs,
    },
  }

  return makeAxisBlock('', axis)
}

/** Check if a tikzpicture contains an axis environment */
export function hasTikzAxis(content: string): boolean {
  return content.includes('\\begin{axis}')
}

/** Check if a tikzpicture contains \draw ... plot commands (raw function plots) */
export function hasTikzDrawPlot(content: string): boolean {
  return /\\draw\s*\[[^\]]*\]\s*plot\s*\(\\x/.test(content)
}

/**
 * Regex fragments for x/y axis arrows drawn as `\draw[->] (xmin,0)--(xmax,0)`.
 * pgfplots/tikz files that draw the axes manually (rather than with
 * `\begin{axis}`) use these to establish the coordinate system before drawing
 * geometric shapes.
 */
const X_AXIS_ARROW_RE =
  /\\draw\s*(?:\[[^\]]*(?:->|latex|stealth)[^\]]*\])\s*\((-?\d+(?:\.\d+)?)\s*,\s*0\)\s*--\s*\((-?\d+(?:\.\d+)?)\s*,\s*0\)/
const Y_AXIS_ARROW_RE =
  /\\draw\s*(?:\[[^\]]*(?:->|latex|stealth)[^\]]*\])\s*\(\s*0\s*,\s*(-?\d+(?:\.\d+)?)\)\s*--\s*\(\s*0\s*,\s*(-?\d+(?:\.\d+)?)\)/

/**
 * "Geometry inside an axis system" — the tikz draws its own `\draw[->]` axes
 * plus one or more geometric shapes (`\draw (X,Y) -- (X,Y) -- ... -- cycle;`)
 * with numeric coordinates. Previously routed to the geometry parser, which
 * ignored the axes and produced a bounding-box drawing without a coordinate
 * system.
 */
export function hasTikzAxisGeometry(content: string): boolean {
  if (content.includes('\\begin{axis}')) return false
  const hasXAxis = X_AXIS_ARROW_RE.test(content)
  const hasYAxis = Y_AXIS_ARROW_RE.test(content)
  if (!hasXAxis || !hasYAxis) return false

  // Shape via `\draw (X,Y) -- (X,Y)` with numeric coordinates.
  const numericShapeRe =
    /\\draw\s*(?:\[[^\]]*\])?\s*\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)\s*--\s*\((-?\d+(?:\.\d+)?)/g
  let match: RegExpExecArray | null
  while ((match = numericShapeRe.exec(content)) !== null) {
    const y1 = parseFloat(match[2])
    const y2 = parseFloat(match[4])
    const isAxisDraw = (y1 === 0 && y2 === 0) || (match[1] === '0' && match[3] === '0')
    if (!isAxisDraw) return true
  }

  // Named-coord shapes: `\coordinate (Name) at ...` (Bagrut style).
  if (content.includes('\\coordinate')) return true

  // Smooth-plot-through-points: `\draw[opts] plot[smooth] coordinates {(X,Y) ...}`
  // — common for sketching functions from a table of sample points.
  if (/\\draw[^;]*\bplot\b[^;]*\bcoordinates\s*\{/.test(content)) return true

  return false
}

/**
 * Parse an "axis + geometric shapes" tikz into a `question_axis` block.
 * Emits the axis viewport from the `\draw[->]` arrow ranges, labeled points
 * from `\node[pos] at (X,Y) {label}` and `\filldraw (Name) circle (Xpt) node[...] {label}`,
 * line segments between coordinate pairs (numeric or named via `\coordinate`),
 * and circles from `\draw (Name) circle (R)`.
 */
export function parseTikzAxisGeometry(content: string): QuestionAxisBlock | null {
  const xAxis = X_AXIS_ARROW_RE.exec(content)
  const yAxis = Y_AXIS_ARROW_RE.exec(content)
  if (!xAxis || !yAxis) return null

  const xMin = parseFloat(xAxis[1])
  const xMax = parseFloat(xAxis[2])
  const yMin = parseFloat(yAxis[1])
  const yMax = parseFloat(yAxis[2])

  // Named coordinates: `\coordinate (M) at (5,-4)` — track name → position
  // so `\draw (M) circle (5)` and `\draw (A) -- (B)` can be resolved back to
  // real numeric points.
  const coordMap = new Map<string, { x: number; y: number }>()
  const coordRe =
    /\\coordinate\s*\((\w+)\)\s*at\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g
  let cMatch: RegExpExecArray | null
  while ((cMatch = coordRe.exec(content)) !== null) {
    coordMap.set(cMatch[1], { x: parseFloat(cMatch[2]), y: parseFloat(cMatch[3]) })
  }

  const resolvePoint = (token: string): { x: number; y: number } | null => {
    const named = coordMap.get(token)
    if (named) return named
    const numeric = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(token)
    if (numeric) return { x: parseFloat(numeric[1]), y: parseFloat(numeric[2]) }
    return null
  }

  // `\node[pos] at (X,Y) {label}` — pure text label (no marker dot). Axis-tick
  // number labels (`\node at (-2, -0.3) {-2}`) and general standalone labels
  // both take this form; a bare `\node at` never draws a dot in TikZ, so
  // emit as `floating_text` not `point`.
  const points: AxisSpecV1['elements']['points'] = []
  const nodeRe =
    /\\node\s*(?:\[([^\]]*)\])?\s*at\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let nMatch: RegExpExecArray | null
  while ((nMatch = nodeRe.exec(content)) !== null) {
    const opts = nMatch[1] ?? ''
    const x = parseFloat(nMatch[2])
    const y = parseFloat(nMatch[3])
    if (isNaN(x) || isNaN(y)) continue
    // Skip axis endpoint labels ($x$, $y$) — they're the arrow-tip annotations.
    const label = cleanNodeLabel(nMatch[4])
    if (!label || label === 'x' || label === 'y') continue
    const labelPosition = resolveTikzLabelPosition(opts)
    points.push({
      x,
      y,
      type: 'floating_text' as const,
      label,
      ...(labelPosition ? { labelPosition } : {}),
    })
  }

  // Points from `\filldraw (Name-or-X,Y) circle (2pt) node[pos] {label}` —
  // these DO draw a dot. Capture the `node[pos]` positioning so the label
  // renders beside the dot instead of overlapping it.
  const filldrawRe =
    /\\filldraw\s*(?:\[[^\]]*\])?\s*\(([^)]+)\)\s*circle\s*\(\s*[\d.]+\s*pt\s*\)\s*node\s*(?:\[([^\]]*)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let fMatch: RegExpExecArray | null
  while ((fMatch = filldrawRe.exec(content)) !== null) {
    const pt = resolvePoint(fMatch[1])
    if (!pt) continue
    const nodeOpts = fMatch[2] ?? ''
    const label = cleanNodeLabel(fMatch[3])
    const labelPosition = resolveTikzLabelPosition(nodeOpts)
    points.push({
      x: pt.x,
      y: pt.y,
      type: 'point' as const,
      label: label || undefined,
      ...(labelPosition ? { labelPosition } : {}),
    })
  }

  // Circles: `\draw[opts] (Name-or-X,Y) circle (radius)` — emit as
  // geometricLoci with the implicit-form `(x-cx)^2 + (y-cy)^2 = r^2` that
  // the axis renderer's `tryParseCircle` fast-path picks up.
  const geometricLoci: NonNullable<AxisSpecV1['elements']['geometricLoci']> = []
  const circleRe =
    /\\draw\s*(?:\[([^\]]*)\])?\s*\(([^)]+)\)\s*circle\s*\(\s*([\d.]+)\s*(?:cm|mm|pt|em|ex)?\s*\)/g
  let circleMatch: RegExpExecArray | null
  while ((circleMatch = circleRe.exec(content)) !== null) {
    const opts = circleMatch[1] ?? ''
    const centerToken = circleMatch[2]
    const radius = parseFloat(circleMatch[3])
    if (!Number.isFinite(radius) || radius <= 0) continue
    const center = resolvePoint(centerToken)
    if (!center) continue
    // Skip tiny circles (point markers, usually `2pt`) — those are handled
    // by the `\filldraw ... circle (2pt) node ...` branch as labeled points.
    if (radius < 1) continue
    const xTerm = center.x === 0 ? 'x' : `(x${center.x > 0 ? '-' : '+'}${Math.abs(center.x)})`
    const yTerm = center.y === 0 ? 'y' : `(y${center.y > 0 ? '-' : '+'}${Math.abs(center.y)})`
    const equation = `${xTerm}^2+${yTerm}^2=${radius * radius}`
    const style: 'solid' | 'dashed' = opts.includes('dashed') ? 'dashed' : 'solid'
    const thickness = opts.includes('thick') ? 2 : 1
    geometricLoci.push({ equation, style, thickness })
  }

  // Line segments: each `\draw[...] (X,Y)|(Name) -- (X,Y)|(Name) -- ... [-- cycle];`.
  const lineBetweenPoints: NonNullable<AxisSpecV1['elements']['lineBetweenPoints']> = []
  const drawRe = /\\draw\s*(?:\[([^\]]*)\])?\s*([^;]+);/g
  let dMatch: RegExpExecArray | null
  while ((dMatch = drawRe.exec(content)) !== null) {
    const opts = dMatch[1] ?? ''
    const path = dMatch[2]
    // Skip axis arrow draws.
    if (/->|latex|stealth/.test(opts) && /\(\s*0\s*,|\s*,\s*0\s*\)/.test(path)) continue
    // Skip circle draws (handled above).
    if (/\)\s*circle\s*\(/.test(path)) continue
    // Skip if path doesn't chain with `--`.
    if (!path.includes('--')) continue

    // Split into (coord) tokens.
    const tokenRe = /\(([^)]+)\)/g
    const chain: Array<{ x: number; y: number }> = []
    let tMatch: RegExpExecArray | null
    while ((tMatch = tokenRe.exec(path)) !== null) {
      const pt = resolvePoint(tMatch[1])
      if (pt) chain.push(pt)
    }
    if (chain.length < 2) continue
    if (chain.length === 2) {
      const [a, b] = chain
      if ((a.y === 0 && b.y === 0) || (a.x === 0 && b.x === 0)) continue
    }
    const style: 'solid' | 'dashed' = opts.includes('dashed') ? 'dashed' : 'solid'
    const thickness = opts.includes('thick') ? 2 : 1
    for (let i = 0; i < chain.length - 1; i++) {
      lineBetweenPoints.push({ style, thickness, a: chain[i], b: chain[i + 1] })
    }
    if (/--\s*cycle/.test(path)) {
      lineBetweenPoints.push({
        style,
        thickness,
        a: chain[chain.length - 1],
        b: chain[0],
      })
    }
  }

  // Smooth-plot-through-points: `\draw[opts] plot[smooth[, tension=…]]
  // coordinates {(X,Y) (X,Y) …}`. Emit as `smoothCurves` so the renderer
  // interpolates through the waypoints as a Catmull-Rom spline. Falls back to
  // straight-segment mode only when the plot options DON'T include `smooth`.
  const smoothCurves: NonNullable<AxisSpecV1['elements']['smoothCurves']> = []
  const smoothPlotRe =
    /\\draw\s*(?:\[([^\]]*)\])?\s*plot\s*(?:\[([^\]]*)\])?\s*coordinates\s*\{([^}]+)\}/g
  let spMatch: RegExpExecArray | null
  while ((spMatch = smoothPlotRe.exec(content)) !== null) {
    const drawOpts = spMatch[1] ?? ''
    const plotOpts = spMatch[2] ?? ''
    const inside = spMatch[3]
    const ptRe = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g
    const chain: Array<{ x: number; y: number }> = []
    let pMatch: RegExpExecArray | null
    while ((pMatch = ptRe.exec(inside)) !== null) {
      chain.push({ x: parseFloat(pMatch[1]), y: parseFloat(pMatch[2]) })
    }
    if (chain.length < 2) continue
    const style: 'solid' | 'dashed' = drawOpts.includes('dashed') ? 'dashed' : 'solid'
    const thickness = drawOpts.includes('thick') ? 2 : 1
    if (/\bsmooth\b/.test(plotOpts)) {
      smoothCurves.push({ points: chain, style, thickness })
    } else {
      // Non-smooth `plot coordinates` — straight polyline through the points.
      for (let i = 0; i < chain.length - 1; i++) {
        lineBetweenPoints.push({ style, thickness, a: chain[i], b: chain[i + 1] })
      }
    }
  }

  if (
    points.length === 0 &&
    lineBetweenPoints.length === 0 &&
    geometricLoci.length === 0 &&
    smoothCurves.length === 0
  ) {
    return null
  }

  // Deduplicate identical `lineBetweenPoints`. When named-coord references
  // don't resolve (e.g., TikZ polar arithmetic `($(M) + (340:5)$)`), a chain
  // like `(A) -- (E) -- (D)` degenerates to `(A) -- (D)` and can duplicate an
  // existing line from the same coords. Same for direct duplicates from
  // multiple `\draw` statements.
  const dedupedLines: typeof lineBetweenPoints = []
  const lineKey = (l: (typeof lineBetweenPoints)[number]): string =>
    `${l.a.x},${l.a.y}|${l.b.x},${l.b.y}|${l.style}|${l.thickness}`
  const revKey = (l: (typeof lineBetweenPoints)[number]): string =>
    `${l.b.x},${l.b.y}|${l.a.x},${l.a.y}|${l.style}|${l.thickness}`
  const seen = new Set<string>()
  for (const l of lineBetweenPoints) {
    const k = lineKey(l)
    const kr = revKey(l)
    if (seen.has(k) || seen.has(kr)) continue
    seen.add(k)
    dedupedLines.push(l)
  }

  const axis: AxisSpecV1 = {
    kind: 'cartesian',
    units: 1,
    viewportMode: 'manual',
    grid: { enabled: false },
    // Geometry-in-axis figures are diagrams, not function plots — the
    // curriculum team's overleaf renders don't show tick numbers or the
    // `x`/`y` labels next to the arrows for these. Match that.
    axes: {
      showNumbers: false,
      showLabels: false,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    viewport: { xMin, xMax, yMin, yMax },
    elements: {
      points,
      graphs: [],
      ...(dedupedLines.length > 0 ? { lineBetweenPoints: dedupedLines } : {}),
      ...(geometricLoci.length > 0 ? { geometricLoci } : {}),
      ...(smoothCurves.length > 0 ? { smoothCurves } : {}),
    },
  }

  return makeAxisBlock('', axis)
}
