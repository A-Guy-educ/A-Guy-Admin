/**
 * Serializer: AxisSpecV1 → `%%%`-delimited function-graph DSL.
 *
 * The DSL round-trips through parseFunctionDsl at
 * `src/server/services/lesson-json-import/parse-function-dsl.ts`. The output
 * shape mirrors `נסיון פונקציות.txt` and the parser's own doc comment:
 *
 *   %%%
 *   $f(x) = 2x+3$
 *   color: blue
 *   style: solid
 *   width: 2
 *
 *   p (3,0)
 *   color: black
 *   type: point
 *   label: Point 1
 *
 *   l (0,0) (1,1)
 *   style: dashed
 *   width: 2
 *   %%%
 *   x:[-1,6]
 *   y:[-5,4]
 *   %%%
 *   grid: false
 *   %%%
 *
 * Caveats:
 *   - parseFunctionDsl pads viewport bounds by 15% on reimport, so bounds
 *     will widen slightly after round-trip. Acceptable loss — authors stop
 *     short of boundary content anyway.
 *   - Fields not representable in the DSL (ticks, units, origin, proportion,
 *     interactionSpec, paint ranges, smooth curves, asymptotes) are dropped.
 *   - `axes.showLabels` is one boolean in the DSL (`labels: true/false`),
 *     not per-axis.
 */
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'

type AxisElement = AxisSpecV1['elements']
type AxisPoint = AxisElement['points'][number]
type AxisGraph = AxisElement['graphs'][number]
type AxisLine = NonNullable<AxisElement['lineBetweenPoints']>[number]
type AxisLocus = NonNullable<AxisElement['geometricLoci']>[number]

const SECTION_SEP = '%%%'

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n)
  // Trim trailing zeros, keep at most 4 fractional digits.
  return Number(n.toFixed(4)).toString()
}

function emitProp(key: string, value: string | number | undefined): string | null {
  if (value === undefined || value === '') return null
  return `${key}: ${value}`
}

function emitGraph(graph: AxisGraph): string {
  const header = `$f(x) = ${graph.fn}$`
  const props = [
    emitProp('color', graph.color),
    emitProp('style', graph.style),
    emitProp('width', graph.thickness),
  ].filter((p): p is string => p !== null)
  return [header, ...props].join('\n')
}

function emitPoint(point: AxisPoint): string {
  const header = `p (${fmt(point.x)},${fmt(point.y)})`
  const props = [
    emitProp('color', point.color),
    emitProp('type', point.type),
    emitProp('label', point.label),
  ].filter((p): p is string => p !== null)
  return [header, ...props].join('\n')
}

function emitLineBetweenPoints(line: AxisLine): string {
  const header = `l (${fmt(line.a.x)},${fmt(line.a.y)}) (${fmt(line.b.x)},${fmt(line.b.y)})`
  const props = [
    emitProp('color', line.color),
    emitProp('style', line.style),
    emitProp('width', line.thickness),
  ].filter((p): p is string => p !== null)
  return [header, ...props].join('\n')
}

function emitLocus(locus: AxisLocus): string {
  const header = `$${locus.equation}$`
  const props = [
    emitProp('color', locus.color),
    emitProp('style', locus.style),
    emitProp('width', locus.thickness),
  ].filter((p): p is string => p !== null)
  return [header, ...props].join('\n')
}

function emitElements(spec: AxisSpecV1): string {
  const blocks: string[] = []
  for (const g of spec.elements.graphs) blocks.push(emitGraph(g))
  for (const p of spec.elements.points) blocks.push(emitPoint(p))
  for (const l of spec.elements.lineBetweenPoints ?? []) blocks.push(emitLineBetweenPoints(l))
  for (const l of spec.elements.geometricLoci ?? []) blocks.push(emitLocus(l))
  return blocks.join('\n\n')
}

function emitViewport(spec: AxisSpecV1): string {
  if (!spec.viewport || spec.viewportMode !== 'manual') return ''
  const lines: string[] = []
  const vp = spec.viewport
  if (vp.xMin !== undefined && vp.xMax !== undefined) {
    lines.push(`x:[${fmt(vp.xMin)},${fmt(vp.xMax)}]`)
  }
  if (vp.yMin !== undefined && vp.yMax !== undefined) {
    lines.push(`y:[${fmt(vp.yMin)},${fmt(vp.yMax)}]`)
  }
  if (spec.axes.showLabels) lines.push(`labels: true`)
  return lines.join('\n')
}

function emitSettings(spec: AxisSpecV1): string {
  const lines: string[] = []
  lines.push(`grid: ${spec.grid.enabled ? 'true' : 'false'}`)
  return lines.join('\n')
}

/**
 * Serialize an AxisSpecV1 to the function-graph DSL, wrapped in the
 * `<function>…</function>` tags the v1 lesson parser expects. The inner
 * body uses `%%%` section separators consumed by parseFunctionDsl.
 *
 * Returns `''` when the spec has no renderable content (no graphs, points,
 * lines, or loci) — callers should check for that and skip emitting the
 * block entirely.
 */
export function axisSpecToDsl(spec: AxisSpecV1): string {
  const hasAnyElement =
    spec.elements.graphs.length > 0 ||
    spec.elements.points.length > 0 ||
    (spec.elements.lineBetweenPoints?.length ?? 0) > 0 ||
    (spec.elements.geometricLoci?.length ?? 0) > 0
  if (!hasAnyElement) return ''

  const sections: string[] = []
  sections.push(emitElements(spec))
  const vp = emitViewport(spec)
  const settings = emitSettings(spec)
  if (vp) sections.push(vp)
  if (settings) sections.push(settings)

  const body = [SECTION_SEP, sections.join(`\n${SECTION_SEP}\n`), SECTION_SEP].join('\n')
  return `<function>\n${body}\n</function>`
}
