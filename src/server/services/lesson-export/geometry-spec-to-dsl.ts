/**
 * Serializer: GeometrySpecV1 → `--- <section> ---` Hebrew DSL.
 *
 * The DSL round-trips through parseGeometryDsl at
 * `src/server/services/text-lesson-import/parse-geometry-dsl.ts`. Section
 * headers in the output match the parser's recognised group headers
 * (`נקודות`, `ישרים וקטעים`, `מעגלים`, `זוויות לתצוגה`). Field names and
 * values match the forms exercised in parse-geometry-dsl.test.ts.
 *
 * Caveats — unsupported fields are dropped (no DSL slot to put them in):
 *   - Point: fontSize, labelVisible
 *   - Line: label position (always 'm' on round-trip)
 *   - Circle: radius via `radius:` numeric (we only emit `רדיוס גרפי` for
 *     the stored `radius` number OR `עובר דרך` for the `through` point ref)
 *   - Angle: label position/distance, fontSize
 *   - Vectors, areas, rectangles, triangles, texts, equalSegments,
 *     equalAngles, tangents, interactionSpec — not emitted (parser has no
 *     reverse row for most of these; adding later is non-breaking).
 */
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

type GeomElements = GeometrySpecV1['elements']
type GeomPoint = GeomElements['points'][number]
type GeomLine = GeomElements['lines'][number]
type GeomCircle = GeomElements['circles'][number]
type GeomAngle = GeomElements['angles'][number]

/** Hebrew name for each PositionEnum value accepted by the parser. */
const POSITION_HE: Record<string, string> = {
  tl: 'שמאל-למעלה',
  tr: 'ימין-למעלה',
  bl: 'שמאל-למטה',
  br: 'ימין-למטה',
  t: 'למעלה',
  b: 'למטה',
  r: 'ימין',
  l: 'שמאל',
  m: 'מרכז',
}

/** Inverse of parseGeometryDsl's COLOR_MAP (English → Hebrew). */
const COLOR_EN_TO_HE: Record<string, string> = {
  red: 'אדום',
  blue: 'כחול',
  green: 'ירוק',
  orange: 'כתום',
  gold: 'צהוב',
  purple: 'סגול',
  pink: 'ורוד',
  brown: 'חום',
  black: 'שחור',
  white: 'לבן',
  gray: 'אפור',
  skyblue: 'תכלת',
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return Number(n.toFixed(4)).toString()
}

/**
 * Render a color for the DSL. If it's a known English color, use the Hebrew
 * word (round-trip-safe through the parser). Otherwise emit as-is — the
 * parser's normalizeColor accepts arbitrary strings.
 */
function colorForDsl(color: string | undefined): string | undefined {
  if (!color) return undefined
  const key = color.toLowerCase()
  return COLOR_EN_TO_HE[key] ?? color
}

function joinFields(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(' | ')
}

function emitPoint(point: GeomPoint): string {
  const fields: Array<string | null> = []
  fields.push(`מיקום: X=${fmt(point.x)}, Y=${fmt(point.y)}`)
  if (point.position && POSITION_HE[point.position]) {
    fields.push(`מיקום תווית: ${POSITION_HE[point.position]}`)
  }
  if (point.visible === false) fields.push(`מוצגת: לא`)
  const color = colorForDsl(point.color)
  if (color) fields.push(`צבע: ${color}`)
  return joinFields([`* נקודה ${point.name}`, ...fields])
}

function emitLine(line: GeomLine): string {
  const fields: Array<string | null> = []
  fields.push(`מנקודה ${line.from} לנקודה ${line.to}`)
  const color = colorForDsl(line.color)
  if (color) fields.push(`צבע: ${color}`)
  if (line.thickness !== undefined) fields.push(`עובי: ${line.thickness}`)
  if (line.style === 'dashed') fields.push(`מקווקו: כן`)
  if (line.label?.value) fields.push(`ערך: ${line.label.value}`)
  return joinFields([`* קטע ${line.from}${line.to}`, ...fields])
}

function emitCircle(circle: GeomCircle, index: number): string {
  const fields: Array<string | null> = []
  fields.push(`מרכז: ${circle.center}`)
  if (circle.through) fields.push(`עובר דרך: ${circle.through}`)
  if (circle.radius !== undefined) fields.push(`רדיוס גרפי: ${fmt(circle.radius)}`)
  const color = colorForDsl(circle.color)
  if (color) fields.push(`צבע: ${color}`)
  if (circle.style === 'dashed') fields.push(`מקווקו: כן`)
  return joinFields([`* מעגל ${index + 1}`, ...fields])
}

function emitAngle(angle: GeomAngle): string {
  const name = `${angle.ray1}${angle.center}${angle.ray2}`
  const fields: Array<string | null> = []
  fields.push(`קודקוד: ${angle.center}`)
  if (angle.style === 'square') {
    fields.push(`סימון: ריבוע 90°`)
  } else {
    fields.push(`נמדדת בין: ${angle.center}${angle.ray1} ל- ${angle.center}${angle.ray2}`)
  }
  const color = colorForDsl(angle.color)
  if (color) fields.push(`צבע: ${color}`)
  if (angle.arcRadius !== undefined) fields.push(`רדיוס: ${fmt(angle.arcRadius)}`)
  if (angle.label?.value) fields.push(`ערך: ${angle.label.value}`)
  return joinFields([`* זווית ${name}`, ...fields])
}

/**
 * Serialize a GeometrySpecV1 to Hebrew `--- <section> ---` DSL. Returns `''`
 * when the spec has no renderable content.
 */
export function geometrySpecToDsl(spec: GeometrySpecV1): string {
  const elements = spec.elements
  const sections: string[] = []

  if (elements.points.length > 0) {
    sections.push(`--- נקודות ---`, ...elements.points.map(emitPoint))
  }
  if (elements.lines.length > 0) {
    sections.push(`--- ישרים וקטעים ---`, ...elements.lines.map(emitLine))
  }
  if (elements.circles.length > 0) {
    sections.push(`--- מעגלים ---`, ...elements.circles.map(emitCircle))
  }
  if (elements.angles.length > 0) {
    sections.push(`--- זוויות לתצוגה ---`, ...elements.angles.map(emitAngle))
  }

  return sections.join('\n')
}
