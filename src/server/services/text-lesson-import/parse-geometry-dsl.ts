/**
 * Parser for the geometry sub-block used by the curriculum-team's plain-text
 * lesson format v2. A geometry block is a set of indented section headers
 * (`--- נקודות ---`, `--- ישרים וקטעים ---`, `--- זוויות לתצוגה ---`, …)
 * followed by `* <item> | <field>: <value> | …` rows.
 *
 * The parser is intentionally forgiving: unknown group headers, malformed
 * item rows, and free-form annotations are recorded as warnings and skipped
 * instead of failing the whole geometry block. The importer's fallback path
 * (see convert-text-exercise-v2.ts) will still emit whatever geometry could
 * be recovered, so a single messy angle doesn't nuke the whole drawing.
 */
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import type { PositionEnum } from '@/infra/contracts/primitives'

export interface ParseGeometryDslResult {
  spec: GeometrySpecV1
  warnings: string[]
  /** True when at least one point/segment/angle was successfully parsed. */
  hasContent: boolean
}

const DEFAULT_CANVAS_WIDTH = 400
const DEFAULT_CANVAS_HEIGHT = 400

const GROUP_HEADER_RE = /^-{2,}\s*(.+?)\s*-{2,}\s*$/
const ITEM_RE = /^\*\s*(.*)$/

// Hebrew position words → geometry PositionEnum. Ordered longest-first so
// combined directions ("שמאל-למעלה") don't get shadowed by "שמאל". Word
// boundaries would be nice but JS `\b` is ASCII-only and doesn't fire
// between Hebrew letters and whitespace, so the regexes rely on ordering
// + explicit prefix/suffix instead.
const POSITION_MAP: Array<[RegExp, PositionEnum]> = [
  [/(שמאל[-\s]?למעלה|למעלה[-\s]?שמאל)/, 'tl'],
  [/(ימין[-\s]?למעלה|למעלה[-\s]?ימין)/, 'tr'],
  [/(שמאל[-\s]?למטה|למטה[-\s]?שמאל)/, 'bl'],
  [/(ימין[-\s]?למטה|למטה[-\s]?ימין)/, 'br'],
  [/למעלה/, 't'],
  [/למטה/, 'b'],
  [/(?:^|[^א-ת])(?:מ|)ימין(?:$|[^א-ת])/, 'r'],
  [/(?:^|[^א-ת])(?:מ|)שמאל(?:$|[^א-ת])/, 'l'],
  [/(מרכז|אמצע|middle)/i, 'm'],
]

const COLOR_MAP: Record<string, string> = {
  אדום: 'red',
  כחול: 'blue',
  ירוק: 'green',
  כתום: 'orange',
  צהוב: 'gold',
  סגול: 'purple',
  ורוד: 'pink',
  חום: 'brown',
  שחור: 'black',
  לבן: 'white',
  אפור: 'gray',
  תכלת: 'skyblue',
}

interface Item {
  raw: string
  /** Everything before the first `|` on the row. */
  head: string
  /** Everything after the first `|`, split on additional `|`. */
  fields: string[]
}

function splitItem(raw: string): Item {
  const parts = raw.split('|').map((p) => p.trim())
  return {
    raw,
    head: parts[0] ?? '',
    fields: parts.slice(1),
  }
}

function findField(fields: string[], keys: string[]): string | undefined {
  for (const field of fields) {
    const colonIdx = field.indexOf(':')
    if (colonIdx === -1) continue
    const name = field.slice(0, colonIdx).trim()
    const value = field.slice(colonIdx + 1).trim()
    for (const key of keys) {
      if (name === key || name.startsWith(key + ' ') || name.startsWith(key + '(')) {
        return value
      }
    }
  }
  return undefined
}

function parseNumberPair(value: string): { x: number; y: number } | null {
  // Matches "X=50, Y=100", "50, 100", or "(50, 100)"
  const cleaned = value.replace(/[()X=Y=xy]/gi, ' ').replace(/,/g, ' ')
  const nums = cleaned.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 2) return null
  return { x: Number(nums[0]), y: Number(nums[1]) }
}

function normalizeLabelPosition(value: string | undefined): PositionEnum | undefined {
  if (!value) return undefined
  for (const [re, pos] of POSITION_MAP) {
    if (re.test(value)) return pos
  }
  return undefined
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // Hex or CSS name passthrough
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9]*$/i.test(trimmed) && !/[א-ת]/.test(trimmed)) return trimmed.toLowerCase()
  const stripped = trimmed.replace(/[^֐-׿]/g, '')
  const mapped = COLOR_MAP[stripped]
  if (mapped) return mapped
  // Fall back to the raw value; validation is only "any string".
  return trimmed
}

function parsePointRow(head: string, fields: string[], point: MutablePoint) {
  // Head looks like "נקודה A" or just "A" or "A (100,100)".
  const nameMatch = head.match(/^(?:נקודה\s+)?([A-Za-z][A-Za-z0-9_]*(?:'|′)?)/)
  if (!nameMatch) return null
  point.name = nameMatch[1]
  let sawCoords = false

  const inlineCoords = head.match(/\(([^)]+)\)/)
  if (inlineCoords) {
    const p = parseNumberPair(inlineCoords[1])
    if (p) {
      point.x = p.x
      point.y = p.y
      sawCoords = true
    }
  }
  const posField = findField(fields, ['מיקום'])
  if (posField) {
    const p = parseNumberPair(posField)
    if (p) {
      point.x = p.x
      point.y = p.y
      sawCoords = true
    }
  } else {
    // Some files skip "מיקום:" and inline `X=50, Y=100` directly as a field.
    for (const f of fields) {
      if (/[xX]\s*=/.test(f)) {
        const p = parseNumberPair(f)
        if (p) {
          point.x = p.x
          point.y = p.y
          sawCoords = true
          break
        }
      }
    }
  }
  if (!sawCoords) return null

  const labelField = findField(fields, ['מיקום תווית', 'תווית'])
  const pos = normalizeLabelPosition(labelField)
  if (pos) point.position = pos

  const visibleField = findField(fields, ['מוצגת', 'מוצג'])
  if (visibleField) {
    if (/^לא/.test(visibleField.trim()) || /^no/i.test(visibleField.trim())) {
      point.visible = false
    }
  }

  const colorField = normalizeColor(findField(fields, ['צבע']))
  if (colorField) point.color = colorField

  return point
}

interface MutablePoint {
  name: string
  x: number
  y: number
  position?: PositionEnum
  visible?: boolean
  labelVisible?: boolean
  color?: string
}

/**
 * "* A (100,100), B (300,100)" — a compressed single-line point list that
 * some authors use. Returns each recognised point separately so the caller
 * can push them into the point map.
 */
function parseCompressedPoints(head: string): MutablePoint[] {
  const out: MutablePoint[] = []
  const parts = head.split(/,\s*(?=[A-Za-z][A-Za-z0-9_]*\s*\()/)
  for (const part of parts) {
    const m = part.match(/^([A-Za-z][A-Za-z0-9_]*(?:'|′)?)\s*\(([^)]+)\)/)
    if (!m) continue
    const coords = parseNumberPair(m[2])
    if (!coords) continue
    out.push({ name: m[1], x: coords.x, y: coords.y })
  }
  return out
}

interface MutableLine {
  from: string
  to: string
  style: 'solid' | 'dashed'
  thickness?: number
  color?: string
  label?: { value?: string; position: 't' | 'b' | 'm' }
}

/**
 * Best-effort segment parser. Accepts:
 *   * קטע AB | מנקודה A לנקודה B [ | …fields ]
 *   * קטע AB
 *   * ישר 1 (AB) | מנקודה A ל- B | …
 * Compressed lists ("* קטע AB, קטע BC, …") are handled by the caller.
 */
function parseSegmentRow(head: string, fields: string[]): MutableLine | null {
  // Try to pull the segment endpoints directly from "AB" (2 letters) in the head.
  const inlineAB = head.match(/(?:קטע|ישר)\s+(?:\d+\s*\()?([A-Za-z])\s*([A-Za-z])\)?/)
  const fromField = findField(fields, ['מנקודה', 'מ'])
  const toField = findField(fields, ['לנקודה', 'ל'])

  let from: string | undefined
  let to: string | undefined
  if (fromField) {
    const m = fromField.match(/([A-Za-z][A-Za-z0-9_]*(?:'|′)?)/)
    if (m) from = m[1]
  }
  if (toField) {
    const m = toField.match(/([A-Za-z][A-Za-z0-9_]*(?:'|′)?)/)
    if (m) to = m[1]
  }

  // Files that write "מנקודה A לנקודה B" as a single field (no colon split).
  for (const f of fields) {
    if (!from || !to) {
      const combined = f.match(
        /מ(?:נקודה)?\s*([A-Za-z][A-Za-z0-9_]*(?:'|′)?)\s*(?:ל(?:נקודה)?)\s*[- ]?\s*([A-Za-z][A-Za-z0-9_]*(?:'|′)?)/,
      )
      if (combined) {
        from = from ?? combined[1]
        to = to ?? combined[2]
      }
    }
  }

  if ((!from || !to) && inlineAB) {
    from = from ?? inlineAB[1]
    to = to ?? inlineAB[2]
  }

  if (!from || !to) return null

  const line: MutableLine = { from, to, style: 'solid' }

  const dashedField = findField(fields, ['מקווקו'])
  if (dashedField && /^כן|^yes/i.test(dashedField.trim())) line.style = 'dashed'

  const colorField = normalizeColor(findField(fields, ['צבע']))
  if (colorField) line.color = colorField

  const thicknessField = findField(fields, ['עובי'])
  if (thicknessField) {
    const n = Number(thicknessField.match(/\d+(?:\.\d+)?/)?.[0])
    if (Number.isFinite(n) && n > 0) line.thickness = n
  }

  const valueField = findField(fields, ['ערך'])
  if (valueField) {
    line.label = { value: valueField, position: 'm' }
  }

  return line
}

interface MutableAngle {
  center: string
  ray1: string
  ray2: string
  arcRadius?: number
  color?: string
  style?: 'arc' | 'square'
  label?: { value?: string; position: 'inside' | 'outside' }
}

function parseAngleRow(head: string, fields: string[]): MutableAngle | null {
  // Head: "זווית AOC" or "זווית A"
  const nameMatch = head.match(/זווית\s+([A-Za-z][A-Za-z0-9_]*)/)
  if (!nameMatch) return null
  const nameLetters = nameMatch[1]

  const centerField = findField(fields, ['קודקוד'])
  let center = centerField
    ? centerField.match(/[A-Za-z][A-Za-z0-9_]*/)?.[0]
    : nameLetters.length === 3
      ? nameLetters[1]
      : undefined
  if (!center) return null

  // "נמדדת בין: OA ל- OC" — extract the two rays' non-center endpoints.
  const raysField = findField(fields, ['נמדדת בין'])
  let ray1: string | undefined
  let ray2: string | undefined
  if (raysField) {
    // "OA ל- OC" or "OA ל OC"
    const parts = raysField.split(/\s*ל[-\s]?\s*/)
    if (parts.length >= 2) {
      const pick = (raw: string) => {
        const cleaned = raw.trim().replace(/[^A-Za-z]/g, '')
        if (cleaned.length === 2) return cleaned[0] === center ? cleaned[1] : cleaned[0]
        if (cleaned.length === 1) return cleaned
        return undefined
      }
      ray1 = pick(parts[0])
      ray2 = pick(parts[1])
    }
  }

  if ((!ray1 || !ray2) && nameLetters.length === 3) {
    // Fall back to name letters: for "AOC" with center "O", rays are A and C.
    const letters = nameLetters.split('')
    const others = letters.filter((l) => l !== center)
    if (others.length >= 2) {
      ray1 = ray1 ?? others[0]
      ray2 = ray2 ?? others[1]
    }
  }

  if (!ray1 || !ray2) return null

  const angle: MutableAngle = { center, ray1, ray2 }

  const colorField = normalizeColor(findField(fields, ['צבע']))
  if (colorField) angle.color = colorField

  const radiusField = findField(fields, ['רדיוס'])
  if (radiusField) {
    const n = Number(radiusField.match(/\d+(?:\.\d+)?/)?.[0])
    if (Number.isFinite(n) && n > 0) angle.arcRadius = n
  }

  const markField = findField(fields, ['סימון'])
  if (markField && /ריבוע|90°|90/.test(markField)) {
    angle.style = 'square'
  }

  const valueField = findField(fields, ['ערך'])
  if (valueField) {
    angle.label = { value: valueField, position: 'inside' }
  }

  return angle
}

function parseCanvasRow(
  fields: string[],
  head: string,
): {
  width?: number
  height?: number
  grid?: boolean
} {
  const combined = [head, ...fields].join(' | ')
  const out: { width?: number; height?: number; grid?: boolean } = {}
  const widthMatch = combined.match(/רוחב\s*(?:קנבס)?:\s*(\d+)/)
  if (widthMatch) out.width = Number(widthMatch[1])
  const heightMatch = combined.match(/גובה\s*(?:קנבס)?:\s*(\d+)/)
  if (heightMatch) out.height = Number(heightMatch[1])
  if (/(?:גריד|רשת|Grid)\s*(?:\(Grid\))?\s*:?\s*(?:מופעל|מופעלת|on|true)/i.test(combined)) {
    out.grid = true
  }
  return out
}

/**
 * Parse a geometry DSL block. `raw` is the text between the header line
 * ("* שרטוט בסיס …:") and the next non-geometry section. Leading/trailing
 * blank lines are ignored.
 */
export function parseGeometryDsl(raw: string): ParseGeometryDslResult {
  const warnings: string[] = []
  const points: MutablePoint[] = []
  const lines: MutableLine[] = []
  const angles: MutableAngle[] = []
  let canvasWidth: number | undefined
  let canvasHeight: number | undefined
  let canvasGrid: boolean | undefined

  let currentGroup: string | null = null

  const source = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const groupMatch = line.match(GROUP_HEADER_RE)
    if (groupMatch) {
      currentGroup = normalizeGroupHeader(groupMatch[1])
      continue
    }

    const itemMatch = line.match(ITEM_RE)
    if (!itemMatch) {
      warnings.push(`Ignored line (no leading '*'): ${line}`)
      continue
    }
    const body = itemMatch[1].trim()
    const item = splitItem(body)

    if (!currentGroup) {
      // Some files skip "--- נקודות ---" and go straight into rows — infer group.
      currentGroup = inferGroupFromHead(item.head) ?? null
      if (!currentGroup) {
        warnings.push(`Ignored orphan row (no group): ${body}`)
        continue
      }
    }

    switch (currentGroup) {
      case 'canvas': {
        const cv = parseCanvasRow(item.fields, item.head)
        if (cv.width) canvasWidth = cv.width
        if (cv.height) canvasHeight = cv.height
        if (cv.grid) canvasGrid = true
        break
      }
      case 'points': {
        // Compressed "A (100,100), B (300,100), …"
        if (/^[A-Za-z][A-Za-z0-9_]*\s*\(/.test(item.head) && item.fields.length === 0) {
          const compressed = parseCompressedPoints(item.head)
          if (compressed.length > 0) {
            points.push(...compressed)
            break
          }
        }
        const scratch: MutablePoint = { name: '', x: 0, y: 0 }
        const parsed = parsePointRow(item.head, item.fields, scratch)
        if (parsed && parsed.name) {
          points.push(parsed)
        } else {
          warnings.push(`Skipped point row: ${body}`)
        }
        break
      }
      case 'segments': {
        // Compressed "קטע AB, קטע BC, …" (word-boundary check omitted — JS
        // `\b` doesn't fire for Hebrew.) When any comma-separated part starts
        // with a קטע/ישר header, treat the whole row as a compressed list.
        if (item.fields.length === 0 && /(?:קטע|ישר)\s+\S+.*,/.test(item.head)) {
          const parts = item.head.split(/,\s*/)
          let ok = false
          for (const part of parts) {
            const line = parseSegmentRow(part.trim(), [])
            if (line) {
              lines.push(line)
              ok = true
            }
          }
          if (ok) break
        }
        const parsed = parseSegmentRow(item.head, item.fields)
        if (parsed) lines.push(parsed)
        else warnings.push(`Skipped segment row: ${body}`)
        break
      }
      case 'angles': {
        const parsed = parseAngleRow(item.head, item.fields)
        if (parsed) angles.push(parsed)
        else warnings.push(`Skipped angle row: ${body}`)
        break
      }
      case 'markers': {
        // Right-angle markers ("סימן זווית ישרה"). We attempt to record an
        // angle with square style if the caller referenced a vertex.
        const centerField = findField(item.fields, ['קודקוד'])
        const between = findField(item.fields, ['בין ישר', 'בין'])
        if (centerField && between) {
          const centerName = centerField.match(/[A-Za-z][A-Za-z0-9_]*/)?.[0]
          const rays = Array.from(between.matchAll(/([A-Za-z][A-Za-z0-9_]*)/g)).map((m) => m[1])
          if (centerName && rays.length >= 2) {
            angles.push({
              center: centerName,
              ray1: rays[0] === centerName ? rays[1] : rays[0],
              ray2: rays.at(-1) === centerName ? rays.at(-2)! : rays.at(-1)!,
              style: 'square',
            })
            break
          }
        }
        warnings.push(`Skipped marker row: ${body}`)
        break
      }
      default:
        warnings.push(`Skipped unknown group '${currentGroup}': ${body}`)
    }
  }

  const spec: GeometrySpecV1 = {
    kind: 'euclidean',
    canvas: {
      width: canvasWidth ?? DEFAULT_CANVAS_WIDTH,
      height: canvasHeight ?? DEFAULT_CANVAS_HEIGHT,
      ...(canvasGrid ? { grid: true } : {}),
    },
    elements: {
      points: points
        .filter((p) => p.name && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({
          name: p.name,
          x: p.x,
          y: p.y,
          ...(p.position ? { position: p.position } : {}),
          ...(p.visible === false ? { visible: false } : {}),
          ...(p.color ? { color: p.color } : {}),
        })),
      lines: lines.map((l) => ({
        from: l.from,
        to: l.to,
        style: l.style,
        ...(l.thickness ? { thickness: l.thickness } : {}),
        ...(l.color ? { color: l.color } : {}),
        ...(l.label ? { label: l.label } : {}),
      })),
      circles: [],
      angles: angles.map((a) => ({
        center: a.center,
        ray1: a.ray1,
        ray2: a.ray2,
        ...(a.arcRadius ? { arcRadius: a.arcRadius } : {}),
        ...(a.color ? { color: a.color } : {}),
        ...(a.style ? { style: a.style } : {}),
        ...(a.label ? { label: a.label } : {}),
      })),
    },
  }

  const hasContent =
    spec.elements.points.length > 0 ||
    spec.elements.lines.length > 0 ||
    spec.elements.angles.length > 0

  return { spec, warnings, hasContent }
}

// --- Group header normalisation --------------------------------------------

function normalizeGroupHeader(raw: string): string | null {
  const t = raw.trim()
  if (/קנבס|רשת|Grid/i.test(t)) return 'canvas'
  if (/נקודות/.test(t)) return 'points'
  if (/ישרים|קטעים/.test(t)) return 'segments'
  if (/^זוויות/.test(t) || /לתצוגה/.test(t)) return 'angles'
  if (/סימונים|סימון/.test(t)) return 'markers'
  return null
}

function inferGroupFromHead(head: string): string | null {
  // JS `\b` is ASCII-only, so use explicit whitespace after the keyword instead.
  if (/^נקודה[\s|]/.test(head) || /^[A-Za-z][A-Za-z0-9_]*\s*\(/.test(head)) return 'points'
  if (/^(?:קטע|ישר)[\s|]/.test(head)) return 'segments'
  if (/^זווית[\s|]/.test(head)) return 'angles'
  if (/^סימן[\s|]/.test(head)) return 'markers'
  if (/רוחב\s*קנבס|גריד|רשת/.test(head)) return 'canvas'
  return null
}
