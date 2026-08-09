/**
 * Parser for the curriculum-team's function-graph DSL. The plain-text format
 * lives in the JSON lesson import as a `function` field on a content block and
 * looks like:
 *
 *   %%%
 *   $f(x) = (x-4)^2 + 3$
 *   color: #3366cc
 *   style: solid
 *   width: 2
 *
 *   $x=5$
 *   color: #89e1ab
 *   style: dotted
 *   width: 2
 *
 *   p (1,1)
 *   color: #ccccff
 *   type: point
 *   label: נסיון
 *
 *   l (0,0) (1,1)
 *   style: dashed
 *   %%%
 *   x:[-1,9]
 *   y:[0,20]
 *   %%%
 *   grid: true
 *   %%%
 *
 * Sections are separated by lines containing only `%%%`. The first section
 * lists elements, each element is a blank-line-separated block whose first
 * line identifies the shape and the following lines carry `key: value`
 * properties. Everything after the elements section is treated as
 * key/value settings (viewport bounds + display flags) regardless of how
 * many `%%%` blocks split them — that way a two- or three-section file
 * both parse the same way.
 *
 * The parser converts to `AxisSpecV1` and always returns a valid spec so
 * the caller can rely on `.spec` even in the presence of soft warnings.
 * Hard errors (missing DSL text, malformed lines) are returned as strings.
 */

import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { LineStyle } from '@/infra/contracts/primitives'

export interface ParsedFunctionDsl {
  spec: AxisSpecV1
  errors: string[]
}

const DEFAULT_LINE_THICKNESS = 2
const DEFAULT_POINT_TYPE = 'point' as const
const DEFAULT_STYLE: LineStyle = 'solid'

const SECTION_SEP_RE = /^\s*%%%\s*$/
const KV_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/
const RANGE_RE = /^\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]$/
const POINT_HEADER_RE = /^p\s+\(([^)]*)\)\s*$/i
const LINE_HEADER_RE = /^l\s+\(([^)]*)\)\s*\(([^)]*)\)\s*$/i
const LATEX_HEADER_RE = /^\$(.+)\$\s*$/
const GRAPH_FN_RE = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*x\s*\)\s*=\s*(.+?)\s*$/i

interface ElementBlock {
  header: string
  props: Record<string, string>
}

function emptyAxisSpec(): AxisSpecV1 {
  return {
    kind: 'cartesian',
    units: 1,
    grid: { enabled: false },
    axes: {
      showNumbers: true,
      showLabels: false,
      ticks: 1,
      labels: { x: 'x', y: 'y' },
      origin: { x: 0, y: 0 },
    },
    viewportMode: 'auto',
    elements: {
      points: [],
      graphs: [],
    },
  }
}

function splitSections(input: string): string[] {
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const sections: string[][] = [[]]
  for (const line of lines) {
    if (SECTION_SEP_RE.test(line)) {
      sections.push([])
      continue
    }
    sections[sections.length - 1].push(line)
  }
  return sections.map((s) => s.join('\n').trim()).filter((s) => s.length > 0)
}

function parseElementBlocks(elementsText: string): ElementBlock[] {
  // Blank-line separated. Any run of ≥1 blank line breaks the block.
  const blocks = elementsText
    .split(/\n\s*\n/)
    .map((b) =>
      b
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    )
    .filter((b) => b.length > 0)

  const out: ElementBlock[] = []
  for (const block of blocks) {
    const [header, ...rest] = block
    const props: Record<string, string> = {}
    for (const line of rest) {
      const m = line.match(KV_RE)
      if (!m) continue
      props[m[1].toLowerCase()] = m[2].trim()
    }
    out.push({ header, props })
  }
  return out
}

function parseNumberPair(raw: string): { x: number; y: number } | null {
  // Accepts `x,y`, `x, y`, and forgives a trailing `,` from author typos
  // like `(0,0,)` — that pattern appears in the reference spec file.
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (parts.length < 2) return null
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function parseStyle(raw: string | undefined): LineStyle {
  if (!raw) return DEFAULT_STYLE
  const v = raw.toLowerCase()
  if (v === 'solid' || v === 'dashed' || v === 'dotted') return v
  return DEFAULT_STYLE
}

function parseThickness(raw: string | undefined): number {
  if (!raw) return DEFAULT_LINE_THICKNESS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LINE_THICKNESS
  return n
}

function parsePointType(raw: string | undefined): 'point' | 'hole' | 'floating_text' {
  if (!raw) return DEFAULT_POINT_TYPE
  const v = raw.toLowerCase()
  if (v === 'point' || v === 'hole' || v === 'floating_text') return v
  return DEFAULT_POINT_TYPE
}

function stripLatexWrapper(header: string): string | null {
  const m = header.match(LATEX_HEADER_RE)
  return m ? m[1].trim() : null
}

function applyElement(
  spec: AxisSpecV1,
  errors: string[],
  block: ElementBlock,
  index: number,
): void {
  const header = block.header
  const props = block.props

  const point = header.match(POINT_HEADER_RE)
  if (point) {
    const coords = parseNumberPair(point[1])
    if (!coords) {
      errors.push(`Element ${index + 1}: point "${header}" has invalid coordinates`)
      return
    }
    spec.elements.points.push({
      x: coords.x,
      y: coords.y,
      type: parsePointType(props.type),
      ...(props.color ? { color: props.color } : {}),
      ...(props.label ? { label: props.label } : {}),
    })
    return
  }

  const line = header.match(LINE_HEADER_RE)
  if (line) {
    const a = parseNumberPair(line[1])
    const b = parseNumberPair(line[2])
    if (!a || !b) {
      errors.push(`Element ${index + 1}: line "${header}" has invalid endpoints`)
      return
    }
    spec.elements.lineBetweenPoints ??= []
    spec.elements.lineBetweenPoints.push({
      style: parseStyle(props.style),
      thickness: parseThickness(props.width),
      a,
      b,
      ...(props.color ? { color: props.color } : {}),
    })
    return
  }

  const equation = stripLatexWrapper(header)
  if (equation === null) {
    errors.push(`Element ${index + 1}: unrecognized header "${header}"`)
    return
  }

  const fnMatch = equation.match(GRAPH_FN_RE)
  if (fnMatch) {
    spec.elements.graphs.push({
      id: `g${spec.elements.graphs.length + 1}`,
      fn: fnMatch[1],
      style: parseStyle(props.style),
      thickness: parseThickness(props.width),
      ...(props.color ? { color: props.color } : {}),
    })
    return
  }

  // Anything else (vertical/horizontal lines like `x=5`, implicit curves like
  // `x^2+y^2=25`) becomes a geometric locus so the color/style/thickness
  // written by the author survive round-trip.
  spec.elements.geometricLoci ??= []
  spec.elements.geometricLoci.push({
    equation,
    style: parseStyle(props.style),
    thickness: parseThickness(props.width),
    ...(props.color ? { color: props.color } : {}),
  })
}

function applySettings(spec: AxisSpecV1, errors: string[], text: string): void {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  for (const line of lines) {
    const m = line.match(KV_RE)
    if (!m) {
      errors.push(`Unrecognized settings line: "${line}"`)
      continue
    }
    const key = m[1].toLowerCase()
    const value = m[2].trim()

    if (key === 'x' || key === 'y') {
      const range = value.match(RANGE_RE)
      if (!range) {
        errors.push(`Invalid range for ${key}: "${value}" (expected [min,max])`)
        continue
      }
      const min = Number(range[1])
      const max = Number(range[2])
      spec.viewport ??= {}
      spec.viewportMode = 'manual'
      if (key === 'x') {
        spec.viewport.xMin = Math.min(min, max)
        spec.viewport.xMax = Math.max(min, max)
      } else {
        spec.viewport.yMin = Math.min(min, max)
        spec.viewport.yMax = Math.max(min, max)
      }
      continue
    }

    if (key === 'grid') {
      spec.grid.enabled = value.toLowerCase() === 'true'
      continue
    }

    if (key === 'labels') {
      // Enable the axis label pair. Value is ignored — authors just write
      // `labels: true` to opt in.
      spec.axes.showLabels = value.toLowerCase() === 'true'
      continue
    }

    errors.push(`Unknown setting: "${key}"`)
  }
}

export function parseFunctionDsl(input: string): ParsedFunctionDsl {
  const spec = emptyAxisSpec()
  const errors: string[] = []

  if (!input || input.trim() === '') {
    errors.push('Function block is empty')
    return { spec, errors }
  }

  const sections = splitSections(input)
  if (sections.length === 0) {
    errors.push('Function block has no content between %%% markers')
    return { spec, errors }
  }

  const [elementsText, ...settingsSections] = sections
  const elements = parseElementBlocks(elementsText)
  elements.forEach((block, idx) => applyElement(spec, errors, block, idx))

  if (settingsSections.length > 0) {
    applySettings(spec, errors, settingsSections.join('\n'))
  }

  return { spec, errors }
}
