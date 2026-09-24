/**
 * Parser for the boss's structured function-graph format. The generator
 * emits blocks like:
 *
 *   ================================================================================
 *   [ גרף בסיס ]
 *   ================================================================================
 *
 *   CONFIGURATION:
 *   Units: 1
 *   XY Proportion: 1
 *   Ticks: 1
 *   Grid: true
 *   Numbers: true
 *   Labels: true
 *   X Label: x
 *   Y Label: y
 *   Manual Range: true
 *   X Min: -6
 *   X Max: 6
 *   Y Min: -6
 *   Y Max: 23
 *
 *   ---
 *
 *   ## GRAPHS
 *
 *   Graph 1:
 *   Function F(X): (1/3)\*(x+2)^2-3
 *   Style: Solid
 *   Width: 2
 *   Color: Red
 *
 *   Graph 2:
 *   …
 *
 *   ---
 *
 *   ## POINTS
 *
 *   A:
 *   X: -2
 *   Y: 21
 *   Type: Point
 *   Label: A
 *   Size: 4
 *   Color: Black
 *
 *   …
 *
 *   ---
 *
 *   ## LINES BETWEEN POINTS
 *
 *   AB:
 *   Points: A > B
 *   Style: Dashed
 *   Width: 2
 *   Color: Black
 *   Arrow: false
 *
 *   ---
 *
 *   ## ASYMPTOTES
 *
 *   None
 *
 *   ---
 *
 *   ## PAINT BETWEEN GRAPHS
 *
 *   None
 *
 *   ================================================================================
 *
 * The parser converts to `AxisSpecV1` — the same target as the legacy
 * `parseFunctionDsl` — so both the v1 text importer and the JSON importer
 * can consume it without any callsite change (parse-function-dsl.ts
 * dispatches by signature).
 */
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { LineStyle } from '@/infra/contracts/primitives'

export interface ParsedFunctionBlockV2 {
  spec: AxisSpecV1
  warnings: string[]
}

// The boss's format is identified by either the `[ גרף בסיס ]` bracket
// header (when a standalone graph file) OR the `CONFIGURATION:` block that
// opens every one (when the graph is embedded inline inside an exercise
// intro). Either signature is enough — a legacy `%%%` DSL block has neither.
const V2_HEADER_RE = /\[\s*גרף\s+בסיס\s*\]/
const V2_CONFIG_RE = /^\s*CONFIGURATION\s*:\s*$/im
const FENCE_RE = /^=+\s*$/
const SEPARATOR_RE = /^-{3,}\s*$/
// Allow leading whitespace — v2 lesson-parser captures its `* גרף בסיס:`
// block with the indented content still indented.
const MARKDOWN_SECTION_RE = /^\s*##\s+(.+?)\s*$/
// Bare section names (`GRAPHS`, `POINTS`, …) also appear on their own line
// when the generator inlines the block into a v1 exercise narrative and
// uses `---\nGRAPHS\n---` as a section header sandwich. Matched only when
// the line is uppercase words up to length ~40 so we don't false-positive
// on Hebrew intro lines or arbitrary content.
const BARE_SECTION_RE = /^\s*([A-Z][A-Z ]+[A-Z])\s*$/
const CONFIG_HEADER_RE = /^\s*CONFIGURATION\s*:\s*$/i
/**
 * An entry header is a line like `Graph 1:` / `A:` / `AB:` (possibly
 * indented) that opens a new sub-block within `## GRAPHS` / `## POINTS` /
 * `## LINES BETWEEN POINTS`. It's distinguished from a `Key: Value`
 * property by having an empty value.
 */
const ENTRY_HEADER_RE = /^\s*([A-Za-z0-9][A-Za-z0-9_ ]*)\s*:\s*$/
const KV_RE = /^\s*([^:]+?)\s*:\s*(.*)$/

/**
 * True when the input carries the boss's `[ גרף בסיס ]` signature. Used by
 * `parseFunctionDsl` to route between the legacy DSL and this parser.
 */
export function isFunctionBlockV2(raw: string): boolean {
  return V2_HEADER_RE.test(raw) || V2_CONFIG_RE.test(raw)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a numeric field. Accepts integers, decimals, and simple fractions
 * like "16/3" (which the generator emits for tidy rational coordinates).
 * Returns `undefined` for anything else so callers can fall back to
 * defaults or warn.
 */
function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const fraction = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)
  if (fraction) {
    const num = Number(fraction[1])
    const den = Number(fraction[2])
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den
  }
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

function parseBool(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  const t = value.trim().toLowerCase()
  if (t === 'true' || t === 'yes' || t === 'on') return true
  if (t === 'false' || t === 'no' || t === 'off') return false
  return undefined
}

function normalizeStyle(value: string | undefined): LineStyle {
  const t = (value ?? '').trim().toLowerCase()
  if (t === 'dashed' || t === 'dash') return 'dashed'
  if (t === 'dotted' || t === 'dot') return 'dotted'
  return 'solid'
}

const NAMED_COLOR_MAP: Record<string, string> = {
  red: 'red',
  blue: 'blue',
  green: 'green',
  orange: 'orange',
  yellow: 'yellow',
  purple: 'purple',
  pink: 'pink',
  brown: 'brown',
  black: 'black',
  white: 'white',
  gray: 'gray',
  grey: 'gray',
  cyan: 'cyan',
  magenta: 'magenta',
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed.toLowerCase()
  const mapped = NAMED_COLOR_MAP[trimmed.toLowerCase()]
  if (mapped) return mapped
  // Any other string is passed through — ColorStringSchema is `z.string()`.
  return trimmed
}

const POINT_TYPE_MAP: Record<string, 'point' | 'hole' | 'floating_text'> = {
  point: 'point',
  hole: 'hole',
  floating_text: 'floating_text',
  floatingtext: 'floating_text',
  text: 'floating_text',
}

function normalizePointType(value: string | undefined): 'point' | 'hole' | 'floating_text' {
  if (!value) return 'point'
  const key = value.trim().toLowerCase().replace(/\s+/g, '')
  return POINT_TYPE_MAP[key] ?? 'point'
}

/**
 * Strip the Markdown escape on `*` before handing the expression to the
 * renderer's function evaluator. The generator writes `(1/3)\*(x+2)^2-3`
 * so the raw `*` doesn't accidentally trigger Markdown emphasis when the
 * source is copy-pasted into review docs.
 */
function cleanFunctionExpression(value: string): string {
  return value.replace(/\\\*/g, '*').trim()
}

// ---------------------------------------------------------------------------
// Section-scoped state
// ---------------------------------------------------------------------------

type SectionName =
  | 'CONFIGURATION'
  | 'GRAPHS'
  | 'POINTS'
  | 'LINES_BETWEEN_POINTS'
  | 'ASYMPTOTES'
  | 'PAINT_BETWEEN_GRAPHS'
  | null

function normalizeSectionName(raw: string): SectionName {
  const t = raw.trim().toUpperCase()
  if (t === 'GRAPHS') return 'GRAPHS'
  if (t === 'POINTS') return 'POINTS'
  if (t.startsWith('LINES BETWEEN')) return 'LINES_BETWEEN_POINTS'
  if (t === 'ASYMPTOTES') return 'ASYMPTOTES'
  if (t.startsWith('PAINT BETWEEN')) return 'PAINT_BETWEEN_GRAPHS'
  if (t === 'CONFIGURATION') return 'CONFIGURATION'
  return null
}

interface Entry {
  header: string
  props: Map<string, string>
}

function emptyEntry(header: string): Entry {
  return { header, props: new Map() }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function baseAxisSpec(): AxisSpecV1 {
  return {
    kind: 'cartesian',
    units: 1,
    grid: { enabled: false },
    axes: {
      showNumbers: true,
      showLabels: true,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    elements: {
      points: [],
      graphs: [],
    },
  }
}

export function parseFunctionBlockV2(raw: string): ParsedFunctionBlockV2 {
  const warnings: string[] = []
  const spec = baseAxisSpec()

  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')

  const config = new Map<string, string>()
  const entries: Record<Exclude<SectionName, null | 'CONFIGURATION'>, Entry[]> = {
    GRAPHS: [],
    POINTS: [],
    LINES_BETWEEN_POINTS: [],
    ASYMPTOTES: [],
    PAINT_BETWEEN_GRAPHS: [],
  }

  let section: SectionName = null
  let currentEntry: Entry | null = null

  const flushEntry = () => {
    if (currentEntry && section && section !== 'CONFIGURATION') {
      entries[section].push(currentEntry)
    }
    currentEntry = null
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')

    if (FENCE_RE.test(line) || SEPARATOR_RE.test(line)) {
      flushEntry()
      continue
    }
    // Bracket-wrapped signature header — not carrying data.
    if (/^\s*\[.+\]\s*$/.test(line)) continue

    const sectionMatch = line.match(MARKDOWN_SECTION_RE)
    if (sectionMatch) {
      flushEntry()
      section = normalizeSectionName(sectionMatch[1])
      continue
    }
    if (CONFIG_HEADER_RE.test(line)) {
      flushEntry()
      section = 'CONFIGURATION'
      continue
    }
    // Bare `GRAPHS` / `POINTS` / `LINES BETWEEN POINTS` etc. — the embedded
    // form the generator inlines into v1 exercises. Only route it as a
    // section header when the token maps to a known section name; anything
    // else (arbitrary UPPERCASE text) is passed through to the current
    // section as-is so we don't accidentally reset state on random noise.
    const bareMatch = line.match(BARE_SECTION_RE)
    if (bareMatch) {
      const bareSection = normalizeSectionName(bareMatch[1])
      if (bareSection) {
        flushEntry()
        section = bareSection
        continue
      }
    }
    if (!section) continue
    if (line.trim() === '') {
      flushEntry()
      continue
    }
    // "None" is the generator's placeholder for an empty section — skip it
    // so we don't emit an entry whose header is literally "None".
    if (/^\s*none\s*$/i.test(line)) continue

    if (section === 'CONFIGURATION') {
      const kv = line.match(KV_RE)
      if (kv) {
        config.set(kv[1].trim().toLowerCase(), kv[2].trim())
      }
      continue
    }

    // Sub-block section — either an entry header (`Graph 1:` with empty
    // value) or a `Key: Value` property row belonging to the current entry.
    const entryHeader = line.match(ENTRY_HEADER_RE)
    if (entryHeader) {
      flushEntry()
      currentEntry = emptyEntry(entryHeader[1].trim())
      continue
    }
    const kv = line.match(KV_RE)
    if (kv) {
      if (!currentEntry) {
        // Property row before any entry header — attach to a synthetic one
        // rather than drop it silently.
        currentEntry = emptyEntry('')
      }
      currentEntry.props.set(kv[1].trim().toLowerCase(), kv[2].trim())
      continue
    }
    warnings.push(`Ignored line inside ${section}: ${line}`)
  }
  flushEntry()

  applyConfiguration(spec, config)
  buildGraphs(spec, entries.GRAPHS, warnings)
  buildPoints(spec, entries.POINTS, warnings)
  buildLines(spec, entries.LINES_BETWEEN_POINTS, warnings)
  buildAsymptotes(spec, entries.ASYMPTOTES, warnings)
  buildPaintBetween(spec, entries.PAINT_BETWEEN_GRAPHS, warnings)

  return { spec, warnings }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function applyConfiguration(spec: AxisSpecV1, config: Map<string, string>) {
  const units = parseNumber(config.get('units'))
  if (units && units > 0) spec.units = units

  const proportion = parseNumber(config.get('xy proportion'))
  if (proportion && proportion > 0) spec.proportion = proportion

  const ticks = parseNumber(config.get('ticks'))
  if (ticks !== undefined && Number.isInteger(ticks) && ticks >= 0) {
    spec.axes.ticks = ticks
  }

  const grid = parseBool(config.get('grid'))
  if (grid !== undefined) spec.grid.enabled = grid

  const numbers = parseBool(config.get('numbers'))
  if (numbers !== undefined) spec.axes.showNumbers = numbers

  const labels = parseBool(config.get('labels'))
  if (labels !== undefined) spec.axes.showLabels = labels

  const xLabel = config.get('x label')
  if (xLabel) spec.axes.labels.x = xLabel
  const yLabel = config.get('y label')
  if (yLabel) spec.axes.labels.y = yLabel

  const manualRange = parseBool(config.get('manual range'))
  const xMin = parseNumber(config.get('x min'))
  const xMax = parseNumber(config.get('x max'))
  const yMin = parseNumber(config.get('y min'))
  const yMax = parseNumber(config.get('y max'))
  const anyRange =
    xMin !== undefined || xMax !== undefined || yMin !== undefined || yMax !== undefined
  if (manualRange || anyRange) {
    spec.viewportMode = 'manual'
    spec.viewport = {}
    if (xMin !== undefined) spec.viewport.xMin = xMin
    if (xMax !== undefined) spec.viewport.xMax = xMax
    if (yMin !== undefined) spec.viewport.yMin = yMin
    if (yMax !== undefined) spec.viewport.yMax = yMax
  }
}

function buildGraphs(spec: AxisSpecV1, list: Entry[], warnings: string[]) {
  list.forEach((entry, idx) => {
    const fnRaw =
      entry.props.get('function f(x)') ??
      entry.props.get('function') ??
      entry.props.get('f(x)') ??
      entry.props.get('fn')
    if (!fnRaw) {
      warnings.push(`Graph ${entry.header || idx + 1}: missing Function`)
      return
    }
    const fn = cleanFunctionExpression(fnRaw)
    if (!fn) {
      warnings.push(`Graph ${entry.header || idx + 1}: empty Function after cleanup`)
      return
    }
    const style = normalizeStyle(entry.props.get('style'))
    const thickness = parseNumber(entry.props.get('width')) ?? 2
    const color = normalizeColor(entry.props.get('color'))
    spec.elements.graphs.push({
      id: entry.header?.trim() || `graph-${idx + 1}`,
      fn,
      style,
      thickness,
      ...(color ? { color } : {}),
    })
  })
}

function buildPoints(spec: AxisSpecV1, list: Entry[], warnings: string[]) {
  list.forEach((entry, idx) => {
    const x = parseNumber(entry.props.get('x'))
    const y = parseNumber(entry.props.get('y'))
    if (x === undefined || y === undefined) {
      warnings.push(`Point ${entry.header || idx + 1}: missing X/Y`)
      return
    }
    const label = entry.props.get('label')?.trim() || entry.header?.trim() || undefined
    const type = normalizePointType(entry.props.get('type'))
    const color = normalizeColor(entry.props.get('color'))
    const size = parseNumber(entry.props.get('size'))
    spec.elements.points.push({
      x,
      y,
      type,
      ...(label ? { label } : {}),
      ...(color ? { color } : {}),
      ...(size !== undefined && Number.isInteger(size) && size >= 1 && size <= 10 ? { size } : {}),
    })
  })
}

function findPoint(spec: AxisSpecV1, name: string): { x: number; y: number } | undefined {
  const target = name.trim()
  if (!target) return undefined
  const byLabel = spec.elements.points.find((p) => p.label === target)
  if (byLabel) return { x: byLabel.x, y: byLabel.y }
  // Fallback: inline coordinate `(1,2)` in place of a name.
  const inline = target.match(/^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/)
  if (inline) return { x: Number(inline[1]), y: Number(inline[2]) }
  return undefined
}

function buildLines(spec: AxisSpecV1, list: Entry[], warnings: string[]) {
  if (list.length === 0) return
  const lines: NonNullable<AxisSpecV1['elements']['lineBetweenPoints']> = []
  list.forEach((entry, idx) => {
    const pointsField = entry.props.get('points') ?? entry.header ?? ''
    // "A > B" or "AB" — accept both.
    let a: string | undefined
    let b: string | undefined
    const arrow = pointsField.match(/^\s*([^>]+?)\s*>\s*(.+?)\s*$/)
    if (arrow) {
      a = arrow[1]
      b = arrow[2]
    } else if (entry.header && entry.header.length === 2) {
      a = entry.header[0]
      b = entry.header[1]
    }
    if (!a || !b) {
      warnings.push(`Line ${entry.header || idx + 1}: unrecognised endpoints`)
      return
    }
    const from = findPoint(spec, a)
    const to = findPoint(spec, b)
    if (!from || !to) {
      warnings.push(`Line ${entry.header || idx + 1}: endpoint ${a} > ${b} not found in POINTS`)
      return
    }
    const style = normalizeStyle(entry.props.get('style'))
    const thickness = parseNumber(entry.props.get('width')) ?? 2
    const color = normalizeColor(entry.props.get('color'))
    const arrowFlag = parseBool(entry.props.get('arrow'))
    lines.push({
      style,
      thickness,
      a: from,
      b: to,
      ...(color ? { color } : {}),
      ...(arrowFlag !== undefined ? { arrow: arrowFlag } : {}),
    })
  })
  if (lines.length > 0) spec.elements.lineBetweenPoints = lines
}

function buildAsymptotes(spec: AxisSpecV1, list: Entry[], warnings: string[]) {
  const vertical: number[] = []
  const horizontal: number[] = []
  list.forEach((entry, idx) => {
    const type = entry.props.get('type')?.trim().toLowerCase()
    const value = parseNumber(entry.props.get('value') ?? entry.props.get('at'))
    if (value === undefined || !type) {
      warnings.push(`Asymptote ${entry.header || idx + 1}: missing Type or Value`)
      return
    }
    if (type === 'vertical' || type === 'v') vertical.push(value)
    else if (type === 'horizontal' || type === 'h') horizontal.push(value)
    else warnings.push(`Asymptote ${entry.header || idx + 1}: unknown Type '${type}'`)
  })
  if (vertical.length) spec.elements.asymptotesVertical = vertical
  if (horizontal.length) spec.elements.asymptotesHorizontal = horizontal
}

function buildPaintBetween(spec: AxisSpecV1, list: Entry[], warnings: string[]) {
  if (list.length === 0) return
  const paints: NonNullable<AxisSpecV1['elements']['paintBetweenGraphs']> = []
  list.forEach((entry, idx) => {
    const first = entry.props.get('first graph') ?? entry.props.get('first')
    const second = entry.props.get('second graph') ?? entry.props.get('second')
    const fromX = parseNumber(entry.props.get('from x') ?? entry.props.get('from'))
    const toX = parseNumber(entry.props.get('to x') ?? entry.props.get('to'))
    if (!first || !second || fromX === undefined || toX === undefined) {
      warnings.push(`Paint ${entry.header || idx + 1}: missing First/Second/From/To`)
      return
    }
    const fillColor = normalizeColor(entry.props.get('fill') ?? entry.props.get('color'))
    paints.push({
      firstGraphId: first.trim(),
      secondGraphId: second.trim(),
      fromX,
      toX,
      ...(fillColor ? { fillColor } : {}),
    })
  })
  if (paints.length > 0) spec.elements.paintBetweenGraphs = paints
}
