/**
 * Parser for the curriculum-team's v2 plain-text lesson format. The format
 * dropped the strict "תרגיל N – <category>: <subtopic>" title conventions
 * and instead uses bracketed section labels wrapped in `====` fences:
 *
 *   =========================================
 *   [ תרגיל 1 - נתוני פתיחה ]
 *   =========================================
 *   * טקסט: <intro paragraph>
 *   * שרטוט בסיס (מבנה אובייקטים):
 *     --- נקודות ---
 *     * נקודה A | מיקום: X=50, Y=50 | מיקום תווית: שמאל-למעלה | מוצגת: כן
 *     …
 *   =========================================
 *   [ תרגיל 1 - סעיף א' - שאלת ברירה יחידה ]
 *   =========================================
 *   * סוג השאלה: Single Choice
 *   * הנחיה: <question>
 *   * שרטוט מותאם לסעיף:
 *     --- נקודות --- …
 *   * אפשרות 1: <text>
 *   * אפשרות 2: <text> [תשובה נכונה]
 *
 * The section header can also appear as `[ סעיף א' - שאלת ברירה יחידה ]`
 * (no `תרגיל N -` prefix) when the section is unambiguously under the last
 * exercise, so the parser accepts both variants.
 *
 * Geometry parsing itself lives in parse-geometry-dsl.ts; here we just
 * capture the raw block text between the geometry field marker and the
 * next top-level field / separator.
 */
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'
import { parseFunctionDsl } from '@/server/services/lesson-json-import/parse-function-dsl'

import { parseGeometryDsl } from './parse-geometry-dsl'

export type QuestionTypeV2 =
  /** `Single Choice` — exactly one correct option. */
  | { kind: 'mcq'; optionsCount: number; selectionMode: 'single' }
  /** `Multiple Choice` — one or more correct options. */
  | { kind: 'mcq'; optionsCount: number; selectionMode: 'multiple' }
  | { kind: 'free_response' }
  | { kind: 'matching' }
  | { kind: 'table' }
  | { kind: 'unknown'; raw: string }

export interface TextOptionV2 {
  text: string
  correct: boolean
}

/** A `* צמד N: <left> <---> <right>` pair, captured for `Matching` sections. */
export interface TextMatchingPairV2 {
  left: string
  right: string
}

/**
 * Parsed table body for `Fill-in Table` sections. Shape mirrors the
 * `question_table` block's `table` field so the converter can hand this
 * straight through:
 *   - `headers`: column names, in declaration order.
 *   - `rowsData`: per-row cell strings; blanks (to fill in) are empty strings.
 *   - `answers`: `{ "rowIdx-colIdx": correctValue }` for each fillable cell.
 * The converter always emits with `solutionFill: true` — that's the whole
 * point of importing a table question (student fills the blanks).
 */
export interface TextTableV2 {
  headers: string[]
  rowsData: string[][]
  answers: Record<string, string>
}

export interface TextSectionV2 {
  /** Hebrew section letter, e.g. "א". Empty when not detected. */
  questionNumber: string
  /** Everything after `סעיף X -` on the header line — usually the question type. */
  headerRest: string
  question: string
  hint?: string
  fullSolution?: string
  type: QuestionTypeV2
  options: TextOptionV2[]
  /** Left/right pairs captured from `* צמד N: <left> <---> <right>` rows. Only populated for `Matching` sections. */
  matchingPairs: TextMatchingPairV2[]
  /** Parsed table body — set for `Fill-in Table` sections whose `* מבנה טבלה (עמודות: …):` block yielded ≥1 row. */
  table?: TextTableV2
  /** Parsed DSL geometry from `שרטוט מותאם לסעיף`. Set only when the section has its own DSL block — never falls back to the exercise's shared geometry (that would double-emit the sketch, once via sharedBlocks and once as an attachment). */
  geometry?: GeometrySpecV1
  /** Raw SVG markup pulled from `שרטוט מותאם לסעיף` when the block was inline `<svg>` rather than DSL. Mutually exclusive with `geometry`. */
  svg?: string
  /**
   * IDs from bare `* מעגל N` rows in the section's own geometry block. The
   * boss's per-section sketches often repeat points/segments in compressed
   * form but reference the exercise-level circle by ID only (no `מרכז`).
   * The converter uses this to copy in the exercise's shared circles so the
   * section attachment still shows the ring.
   */
  bareCircleRefs: string[]
  /** Parsed function graph from `גרף מותאם לסעיף`. Follows the same "own-only, no shared fallback" rule as `geometry`. */
  functionGraph?: AxisSpecV1
  geometryWarnings: string[]
}

export interface TextExerciseV2 {
  exerciseNumber: string
  /** Everything after the exercise header prefix. Usually "נתוני פתיחה" — kept as-is for downstream titling. */
  headerRest: string
  /** Free narrative pulled from the "* טקסט:" field. */
  intro: string
  /** Parsed DSL geometry from `שרטוט בסיס`. */
  sharedGeometry?: GeometrySpecV1
  /** Raw SVG markup pulled from `שרטוט בסיס` when the block was inline `<svg>` rather than DSL. Mutually exclusive with `sharedGeometry`. */
  sharedSvg?: string
  /** Parsed function graph from `גרף בסיס` at the exercise level (the boss's structured `[ גרף בסיס ]` format). */
  sharedFunctionGraph?: AxisSpecV1
  sharedGeometryWarnings: string[]
  sections: TextSectionV2[]
}

export interface TextLessonV2 {
  lessonName?: string
  exercises: TextExerciseV2[]
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

// Accept both spaced (`[ תרגיל 1 - נתוני פתיחה ]`) and tight
// (`[תרגיל 1 - נתוני פתיחה]`) bracket forms — otherwise the preview would
// silently report "0 exercises" for a fixable, legitimately-v2 file.
// The `<prefix> N -` chunk is optional so we also recognise a bare
// `[ נתוני פתיחה ]` header (used in short single-exercise files) and
// the `שאלה` prefix variant (`[ שאלה 1 - נתוני פתיחה ]`).
const V2_SIGNATURE_RE = /\[\s*(?:(?:תרגיל|שאלה)\s+\S+\s*[-–]\s*)?נתוני\s*פתיחה\s*\]/
// v1 files use section headers like `[תרגיל 1 - סעיף א]` which end at the
// section letter with no further dash. v2 files use `[ סעיף X - <question
// type> ]` — always a dash AFTER the label. Requiring that trailing dash
// stops v1 section headers from false-positive triggering v2 detection
// (which would route a legacy file to parseTextLessonV2 and dump its whole
// content into a single synthetic exercise).
const V2_SECTION_SIGNATURE_RE = /\[\s*(?:תרגיל\s+\S+\s*[-–]\s*)?סעיף\s+[^-–\]]+[-–]/

export function isV2Format(raw: string): boolean {
  return V2_SIGNATURE_RE.test(raw) || V2_SECTION_SIGNATURE_RE.test(raw)
}

// ---------------------------------------------------------------------------
// Line-classification regexes
// ---------------------------------------------------------------------------

// Exercise header inside [ ... ] — accepts trailing tokens after the number
// so the header rest ("נתוני פתיחה" or a section-type label) can be
// captured. Both `תרגיל` and `שאלה` are recognised as the prefix.
const EXERCISE_HEADER_RE = /^\[\s*(?:תרגיל|שאלה)\s+(\S+?)\s*[-–]\s*(.+?)\s*\]\s*$/
// Some short files start with a bare `[ נתוני פתיחה ]` — no `תרגיל N -`
// prefix. Treated as opening a synthetic exercise so the following DSL and
// sections still get attributed correctly.
const BARE_INTRO_HEADER_RE = /^\[\s*נתוני\s*פתיחה\s*\]\s*$/
// Section header, either with or without a `תרגיל|שאלה N -` prefix. The
// label is captured with a greedy-lazy pattern that allows extras like
// "1 ויחיד" or a comma-separated multi-label ("א', ב', ג', ד'") — anything
// up to the first " - question-type" tail (or the closing bracket).
const SECTION_HEADER_RE =
  /^\[\s*(?:(?:תרגיל|שאלה)\s+\S+\s*[-–]\s*)?סעיף\s+(.+?)\s*(?:[-–]\s*(.+?))?\s*\]\s*$/
// `[ נתון נוסף ]` and similar intermezzos — the generator inserts these
// between sections to add extra context. Recognised so they don't confuse
// header detection; their content is folded back into the previous section
// or the exercise intro downstream.
const INTERMEZZO_HEADER_RE = /^\[\s*נתון\s+נוסף\s*\]\s*$/
const FIELD_RE = /^\*\s+([^:]+?)\s*:\s*(.*)$/
const OPTION_FIELD_RE = /^אפשרות\s+(\d+)$/
/** `* צמד N: <left> <---> <right>` — a matching-pair row. */
const PAIR_FIELD_RE = /^צמד\s+(\d+)$/
/** Separator between left and right in matching pairs. `<--->`, `<-->`, `<->`, `↔`. */
const PAIR_SEPARATOR_RE = /\s*(?:<-{2,}>|<->|↔)\s*/
const CORRECT_MARKER_RE = /\s*\[\s*תשובה\s+נכונה\s*\]\s*$/
const HEADER_LINE_RE = /^(קורס|פרק|שם השיעור)\s*[-–]\s*(.+)$/
// `* מבנה טבלה (עמודות: X, Y, Z):` — opens a table block. FIELD_RE can't
// parse this because the `(עמודות: …)` parenthetical contains a colon, which
// its `[^:]+?` key group can't cross. Matched BEFORE FIELD_RE in the main
// loop. `מבנה` is optional so the shorter `* טבלה (עמודות: …):` variant works
// too. The parenthetical itself is optional — a bare `* מבנה טבלה:` still
// opens the block, but without headers the finalizer will discard the body
// (there's no safe way to guess column names).
const TABLE_HEADER_RE = /^\*\s+(?:מבנה\s+)?טבלה(?:\s*\(\s*עמודות\s*:\s*([^)]+)\))?\s*:/
/** `  * שורה N | col: val | col: val | …` — one table row. */
const TABLE_ROW_RE = /^\s*\*\s+שורה\s+(\S+)\s*\|(.*)$/
/**
 * A fillable cell placeholder. Two shapes are observed in the boss's output:
 *   `[ שדה ריק - להשלמה: <correct answer> ]`
 *   `[ שדה ריק - <correct answer> ]`
 * `להשלמה` is a meta-instruction ("to be completed") and always precedes
 * the correct value when present.
 */
const TABLE_BLANK_CELL_RE = /^\[\s*שדה\s+ריק\s*[-–]\s*(?:להשלמה\s*:\s*)?(.+?)\s*\]$/

function splitMatchingPair(value: string): [string, string] | [] {
  const parts = value.split(PAIR_SEPARATOR_RE)
  if (parts.length !== 2) return []
  const [left, right] = parts.map((p) => p.trim())
  if (!left || !right) return []
  return [left, right]
}

const isSeparator = (line: string) => {
  const trimmed = line.trim()
  return trimmed.length >= 10 && [...trimmed].every((c) => c === '=' || c === '-')
}

function classifyType(raw: string): QuestionTypeV2 {
  const t = raw.trim()
  if (!t) return { kind: 'unknown', raw }
  // English labels the v2 authors use.
  if (/^open\s*ended\b/i.test(t) || t === 'שאלה פתוחה') return { kind: 'free_response' }
  const singleChoice = t.match(/^single\s*choice(?:\s*\((\d+)\s*options?\))?/i)
  if (singleChoice) {
    const count = singleChoice[1] ? Number(singleChoice[1]) : 2
    return { kind: 'mcq', optionsCount: count, selectionMode: 'single' }
  }
  const multiChoice = t.match(/^multiple\s*choice(?:\s*\((\d+)\s*options?\))?/i)
  if (multiChoice) {
    const count = multiChoice[1] ? Number(multiChoice[1]) : 2
    return { kind: 'mcq', optionsCount: count, selectionMode: 'multiple' }
  }
  const hebrewMcq = t.match(/^בחירה\s+בין\s+(\d+)\s+אפשרויות\b/)
  if (hebrewMcq) return { kind: 'mcq', optionsCount: Number(hebrewMcq[1]), selectionMode: 'single' }
  if (/^matching\b/i.test(t) || /^שאלת\s+התאמה/.test(t)) return { kind: 'matching' }
  if (/^fill[-\s]in\s+table$/i.test(t) || /^שאלת\s+השלמת\s+טבלה$/.test(t)) {
    return { kind: 'table' }
  }
  return { kind: 'unknown', raw }
}

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

/**
 * Which kind of indented block is currently open. `שרטוט …`, `גרף …`, and
 * `מבנה טבלה …` all follow the same "capture indented content until the
 * next top-level field" pattern; the mode remembers whether the collected
 * lines should be handed to parseGeometryDsl, parseFunctionDsl, or the
 * table-row parser.
 */
type BlockMode = 'geometry' | 'function' | 'table'

interface MutableSectionV2 {
  questionNumber: string
  headerRest: string
  question: string
  hint?: string
  fullSolution?: string
  typeRaw: string
  options: TextOptionV2[]
  matchingPairs: TextMatchingPairV2[]
  geometryLines: string[]
  functionLines: string[]
  tableLines: string[]
  /** Column names captured from the `(עמודות: …)` parenthetical on the `* מבנה טבלה` line. Empty when the parenthetical was missing. */
  tableHeaders: string[]
  inBlock: BlockMode | null
}

interface MutableExerciseV2 {
  exerciseNumber: string
  headerRest: string
  intro: string
  sharedGeometryLines: string[]
  sharedFunctionLines: string[]
  inBlock: BlockMode | null
  sections: MutableSectionV2[]
}

function newExercise(num: string, headerRest: string): MutableExerciseV2 {
  return {
    exerciseNumber: num,
    headerRest,
    intro: '',
    sharedGeometryLines: [],
    sharedFunctionLines: [],
    inBlock: null,
    sections: [],
  }
}

function newSection(num: string, headerRest: string): MutableSectionV2 {
  return {
    questionNumber: num,
    headerRest,
    question: '',
    typeRaw: '',
    options: [],
    matchingPairs: [],
    geometryLines: [],
    functionLines: [],
    tableLines: [],
    tableHeaders: [],
    inBlock: null,
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type SectionFieldSlot = 'question' | 'hint' | 'fullSolution'
type ExerciseFieldSlot = 'intro'

type ApplySectionResult =
  | { kind: 'block-start'; mode: BlockMode }
  | { kind: 'option' }
  | { kind: 'type' }
  | { kind: 'consumed'; slot: SectionFieldSlot }
  | { kind: 'passthrough' }

type ApplyExerciseResult =
  | { kind: 'block-start'; mode: BlockMode }
  | { kind: 'consumed'; slot: ExerciseFieldSlot }
  | { kind: 'passthrough' }

/**
 * Field names on the exercise level that map directly onto structured intro/
 * geometry state. Anything else is treated as free-form narrative appended
 * to the intro so nothing is silently lost.
 */
/**
 * Strip a trailing `(…)` clarifier from a field key. Authors annotate
 * revised versions inline: `* פתרון מלא (מתוקן):`, `* שרטוט בסיס (מתוקן 2):`,
 * `* שרטוט בסיס (מבנה אובייקטים):`. Without stripping, none of these match
 * the exact-key checks below and the value cascades into whichever slot
 * was previously open — usually spilling a whole geometry block into
 * fullSolution. Trailing whitespace before the paren is fine.
 */
function normalizeFieldKey(key: string): string {
  return key.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function applyExerciseField(
  ex: MutableExerciseV2,
  key: string,
  value: string,
): ApplyExerciseResult {
  const k = normalizeFieldKey(key)
  if (k === 'טקסט') {
    ex.intro = ex.intro ? `${ex.intro}\n${value}` : value
    return { kind: 'consumed', slot: 'intro' }
  }
  if (k === 'שרטוט בסיס' || k === 'שרטוט בסיסי') {
    ex.inBlock = 'geometry'
    return { kind: 'block-start', mode: 'geometry' }
  }
  if (k === 'גרף בסיס' || k === 'גרף בסיסי' || k === 'גרף') {
    ex.inBlock = 'function'
    return { kind: 'block-start', mode: 'function' }
  }
  return { kind: 'passthrough' }
}

function applySectionField(sec: MutableSectionV2, key: string, value: string): ApplySectionResult {
  const k = normalizeFieldKey(key)
  if (k === 'סוג השאלה' || k === 'סוג תרגיל') {
    sec.typeRaw = value
    return { kind: 'type' }
  }
  if (k === 'הנחיה' || k === 'תוכן השאלה' || k === 'טקסט נלווה') {
    sec.question = sec.question ? `${sec.question}\n${value}` : value
    return { kind: 'consumed', slot: 'question' }
  }
  if (k === 'רמז') {
    sec.hint = sec.hint ? `${sec.hint}\n${value}` : value
    return { kind: 'consumed', slot: 'hint' }
  }
  if (k === 'פתרון מלא') {
    sec.fullSolution = sec.fullSolution ? `${sec.fullSolution}\n${value}` : value
    return { kind: 'consumed', slot: 'fullSolution' }
  }
  // Both `שרטוט מותאם*` and `שרטוט בסיס*` are documented ways to attach a
  // per-section sketch. The generator emits `שרטוט בסיס (מתוקן):` when a
  // problem is revised mid-section — treating it as anything other than a
  // geometry block would cascade the DSL rows into fullSolution.
  if (k === 'שרטוט מותאם' || k === 'שרטוט מותאם לסעיף' || k === 'שרטוט בסיס') {
    sec.inBlock = 'geometry'
    return { kind: 'block-start', mode: 'geometry' }
  }
  // Same shape for function graphs (`* גרף מותאם לסעיף:` at the section
  // level, `* גרף בסיס:` when the whole exercise focuses on one graph).
  if (k === 'גרף מותאם' || k === 'גרף מותאם לסעיף' || k === 'גרף בסיס' || k === 'גרף') {
    sec.inBlock = 'function'
    return { kind: 'block-start', mode: 'function' }
  }
  const optionMatch = k.match(OPTION_FIELD_RE)
  if (optionMatch) {
    const trimmed = value.replace(CORRECT_MARKER_RE, '').trim()
    const correct = CORRECT_MARKER_RE.test(value)
    if (trimmed) sec.options.push({ text: trimmed, correct })
    return { kind: 'option' }
  }
  // `* צמד N: <left> <---> <right>` — a matching-pair row. Both `<--->` and
  // its Unicode variants (`↔`, `<->`) count as the separator.
  const pairMatch = k.match(PAIR_FIELD_RE)
  if (pairMatch) {
    const [left, right] = splitMatchingPair(value)
    if (left && right) sec.matchingPairs.push({ left, right })
    return { kind: 'option' }
  }
  return { kind: 'passthrough' }
}

function appendToSlot(sec: MutableSectionV2, slot: SectionFieldSlot, text: string) {
  const current = sec[slot] ?? ''
  sec[slot] = current ? `${current}\n${text}` : text
}

/**
 * Split a captured `שרטוט …` block into an SVG blob or DSL spec.
 *
 * Authors put two flavours of content behind the same `* שרטוט בסיס:` /
 * `* שרטוט מותאם לסעיף:` field:
 *   - DSL rows (`--- נקודות ---` / `--- ישרים וקטעים ---` / …), parsed by
 *     parse-geometry-dsl.ts into a `GeometrySpecV1`.
 *   - Raw `<svg>…</svg>` markup, used for pictorial scenes (a ladder against
 *     a wall, a stack of factoring squares) where the DSL's point-and-segment
 *     vocabulary doesn't apply.
 *
 * If the first non-blank line starts with `<svg`, treat the whole block as
 * SVG and skip the DSL parser (which would return `hasContent: false` and
 * silently drop the block). Anything else goes to the DSL path.
 */
function classifyBlockBody(rawLines: string[]): {
  svg?: string
  spec?: GeometrySpecV1
  warnings: string[]
  hasContent: boolean
  /** Bare `* מעגל N` references the section couldn't resolve on its own. Surfaced so the converter can inherit the exercise's shared circles. */
  bareCircleRefs: string[]
} {
  if (rawLines.length === 0) {
    return { warnings: [], hasContent: false, bareCircleRefs: [] }
  }
  const joined = rawLines.join('\n')
  const firstNonBlank = joined.replace(/^\s+/, '')
  if (/^<svg\b/i.test(firstNonBlank)) {
    return { svg: joined.trim(), warnings: [], hasContent: true, bareCircleRefs: [] }
  }
  const { spec, warnings, hasContent, bareCircleRefs } = parseGeometryDsl(joined)
  return { spec: hasContent ? spec : undefined, warnings, hasContent, bareCircleRefs }
}

function parseFunctionBlock(rawLines: string[]): {
  spec?: AxisSpecV1
  warnings: string[]
} {
  if (rawLines.length === 0) return { warnings: [] }
  const joined = rawLines.join('\n')
  if (!joined.trim()) return { warnings: [] }
  const { spec, errors } = parseFunctionDsl(joined)
  const hasContent = spec.elements.graphs.length > 0 || spec.elements.points.length > 0
  return hasContent ? { spec, warnings: errors } : { warnings: errors }
}

/**
 * Parse captured `* מבנה טבלה (עמודות: X, Y, Z):` body lines into a
 * `TextTableV2`. Each row line is `  * שורה N | col: val | col: val | …`:
 *   - The `שורה N` label becomes the value of the FIRST column (usually
 *     `שלב` — the step number). If the first column happens to declare a
 *     different name, the row label is still slotted at index 0.
 *   - Remaining `|`-separated segments are `colName: value` pairs. Each is
 *     matched to its column by name — segments whose colName isn't in the
 *     header list are dropped with a warning (misspelled colName in source).
 *   - A `[ שדה ריק - … ]` value marks a fillable cell: the visible cell
 *     becomes `""` and the correct answer lands in `answers["rowIdx-colIdx"]`.
 *
 * Returns `undefined` when there's nothing usable (no headers, no rows, or
 * only zero-cell rows) so the converter can fall back cleanly.
 */
function parseTableBody(
  headers: string[],
  lines: string[],
): { table?: TextTableV2; warnings: string[] } {
  const warnings: string[] = []
  if (headers.length === 0) {
    if (lines.some((l) => TABLE_ROW_RE.test(l))) {
      warnings.push('טבלה: חסרה רשימת עמודות (עמודות: X, Y, Z) — הטבלה לא יובאה.')
    }
    return { warnings }
  }
  const rowsData: string[][] = []
  const answers: Record<string, string> = {}
  for (const raw of lines) {
    const m = raw.match(TABLE_ROW_RE)
    if (!m) continue
    const rowLabel = m[1].trim()
    const rest = m[2]
    const cells = new Array<string>(headers.length).fill('')
    // First column: the `שורה N` label. Boss's template always puts the step
    // number here (first column = שלב); we slot it at index 0 unconditionally.
    cells[0] = rowLabel
    // Split on ` | ` (whitespace-pipe-whitespace) instead of plain `|` — the
    // "parallel lines" notation `DE || BC` appears inline in cell values and
    // has no whitespace between its two pipes, so a plain-pipe split would
    // shred that value in half.
    for (const seg of rest
      .split(/\s+\|\s+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const colonIdx = seg.indexOf(':')
      if (colonIdx < 0) continue
      const colName = seg.slice(0, colonIdx).trim()
      const value = seg.slice(colonIdx + 1).trim()
      const colIdx = headers.indexOf(colName)
      if (colIdx < 0) {
        warnings.push(`טבלה: עמודה "${colName}" אינה מופיעה ברשימת העמודות — הערך הושמט.`)
        continue
      }
      const blank = value.match(TABLE_BLANK_CELL_RE)
      if (blank) {
        cells[colIdx] = ''
        answers[`${rowsData.length}-${colIdx}`] = blank[1].trim()
      } else {
        cells[colIdx] = value
      }
    }
    rowsData.push(cells)
  }
  if (rowsData.length === 0) return { warnings }
  return { table: { headers, rowsData, answers }, warnings }
}

function finalizeSection(sec: MutableSectionV2): TextSectionV2 {
  const geometryBody = classifyBlockBody(sec.geometryLines)
  const functionBody = parseFunctionBlock(sec.functionLines)
  const tableBody = parseTableBody(sec.tableHeaders, sec.tableLines)
  return {
    questionNumber: sec.questionNumber,
    headerRest: sec.headerRest,
    question: sec.question.trim(),
    hint: sec.hint?.trim() || undefined,
    fullSolution: sec.fullSolution?.trim() || undefined,
    type: classifyType(sec.typeRaw),
    options: sec.options,
    matchingPairs: sec.matchingPairs,
    table: tableBody.table,
    // Section geometry/svg/graph is set ONLY when the section has its own
    // block. We deliberately do NOT fall back to the exercise-level shared
    // drawing — that would emit the same visual twice (once via
    // sharedBlocks, once per section as an attachment).
    geometry: geometryBody.hasContent ? geometryBody.spec : undefined,
    svg: geometryBody.hasContent ? geometryBody.svg : undefined,
    bareCircleRefs: geometryBody.bareCircleRefs,
    functionGraph: functionBody.spec,
    geometryWarnings: [...geometryBody.warnings, ...functionBody.warnings, ...tableBody.warnings],
  }
}

function finalizeExercise(ex: MutableExerciseV2): TextExerciseV2 {
  const geometryBody = classifyBlockBody(ex.sharedGeometryLines)
  const functionBody = parseFunctionBlock(ex.sharedFunctionLines)
  return {
    exerciseNumber: ex.exerciseNumber,
    headerRest: ex.headerRest,
    intro: ex.intro.trim(),
    sharedGeometry: geometryBody.hasContent ? geometryBody.spec : undefined,
    sharedSvg: geometryBody.hasContent ? geometryBody.svg : undefined,
    sharedFunctionGraph: functionBody.spec,
    sharedGeometryWarnings: [...geometryBody.warnings, ...functionBody.warnings],
    sections: ex.sections.map((s) => finalizeSection(s)),
  }
}

/**
 * A geometry block is indented content between `* שרטוט …:` and the next
 * `* field:` at column 0. Everything else — including blank lines, `---`
 * group markers, and `*` item rows — belongs to the block.
 */
function isTopLevelFieldStart(line: string): boolean {
  return /^\*\s+\S/.test(line) && !line.startsWith('*  ') && !line.startsWith('* ---')
}

/**
 * Split a section-header label like "א', ב', ג', ד'" or "1 ויחיד" into its
 * component sub-labels. Comma-separated Hebrew letters / numbers each become
 * their own section; "N ויחיד" ("N and only") is a single section. Falsy or
 * empty labels return an empty array so the caller can decide the fallback.
 */
function splitSectionLabels(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (!trimmed.includes(',')) return [trimmed]
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseTextLessonV2(raw: string): TextLessonV2 {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')

  const lesson: TextLessonV2 = { exercises: [] }
  let currentEx: MutableExerciseV2 | null = null
  let currentSec: MutableSectionV2 | null = null
  // Tracks which section/exercise slot the LAST recognised `* field:` opened,
  // so that continuation lines (`*   subitem` or bare narrative lines) stick
  // to the correct slot instead of always defaulting to `question` / `intro`.
  // Reset on new bracket header, geometry-start, option row, or a passthrough
  // `* field:` whose key we don't recognise.
  let currentField: SectionFieldSlot | ExerciseFieldSlot | null = null

  const flushSection = () => {
    if (currentSec && currentEx) {
      currentEx.sections.push(currentSec)
      currentSec = null
    }
  }
  const flushExercise = () => {
    flushSection()
    if (currentEx) {
      lesson.exercises.push(finalizeExercise(currentEx))
      currentEx = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Separator lines carry no data.
    if (isSeparator(line)) continue

    // Optional file-level header lines (course/chapter/lesson name).
    if (!currentEx) {
      const hm = line.match(HEADER_LINE_RE)
      if (hm) {
        if (hm[1] === 'שם השיעור') lesson.lessonName = hm[2].trim()
        continue
      }
    }

    // Bracket-wrapped section/exercise headers.
    const bracketed = line.match(/^\s*\[.+\]\s*$/) ? line.trim() : null
    if (bracketed) {
      const secMatch = bracketed.match(SECTION_HEADER_RE)
      // Section headers take priority (they include "סעיף"). Otherwise treat
      // as an exercise header — the "נתוני פתיחה" case falls through here.
      if (secMatch) {
        flushSection()
        if (!currentEx) {
          // Orphan section — attach to a synthetic exercise so we don't lose it.
          currentEx = newExercise('?', '')
        }
        const rawLabel = secMatch[1] ?? ''
        const rest = (secMatch[2] ?? '').trim()
        // Authors sometimes pack several sections into one bracket
        // ("[ סעיף א', ב', ג', ד' - כמו מקודם ]"). Split on commas so we
        // still emit N discrete sections — the target is 4 sections per
        // exercise, and dropping the collapsed ones would leave big holes.
        const labels = splitSectionLabels(rawLabel)
        if (labels.length > 1) {
          for (let li = 0; li < labels.length - 1; li++) {
            const placeholder = newSection(labels[li], rest)
            placeholder.question = rest
            currentEx.sections.push(placeholder)
          }
          currentSec = newSection(labels[labels.length - 1], rest)
          currentSec.question = rest
        } else {
          currentSec = newSection(rawLabel.trim(), rest)
        }
        currentField = null
        continue
      }
      const exMatch = bracketed.match(EXERCISE_HEADER_RE)
      if (exMatch) {
        const num = exMatch[1]
        const rest = exMatch[2].trim()
        flushExercise()
        currentEx = newExercise(num, rest)
        currentSec = null
        currentField = null
        continue
      }
      // Bare `[ נתוני פתיחה ]` — short single-exercise files skip the
      // `תרגיל N -` / `שאלה N -` prefix. Open a synthetic exercise so the
      // downstream DSL and sections still attribute correctly.
      if (BARE_INTRO_HEADER_RE.test(bracketed)) {
        flushExercise()
        currentEx = newExercise('1', 'נתוני פתיחה')
        currentSec = null
        currentField = null
        continue
      }
      // `[ נתון נוסף ]` intermezzo — the generator inserts these between
      // sections to add supplementary context. Close any in-flight section
      // so the following `* טקסט:` / `* שרטוט:` fields land back on the
      // exercise (they act like an intro appendix). Otherwise the section
      // that just closed would gobble up the intermezzo's fields.
      if (INTERMEZZO_HEADER_RE.test(bracketed)) {
        flushSection()
        currentField = null
        continue
      }
      // Unknown bracket header — ignore.
      continue
    }

    // Inside an in-flight geometry/function/table block, greedily consume
    // indented content until we hit a top-level field or a separator on the
    // NEXT iteration. Function and table blocks reuse the same "capture until
    // next top-level field" loop as geometry — only the destination buffer
    // differs.
    if (currentSec && currentSec.inBlock) {
      if (isTopLevelFieldStart(line)) {
        currentSec.inBlock = null
        // fall through to field-detection below
      } else {
        if (currentSec.inBlock === 'function') currentSec.functionLines.push(line)
        else if (currentSec.inBlock === 'table') currentSec.tableLines.push(line)
        else currentSec.geometryLines.push(line)
        continue
      }
    } else if (currentEx && currentEx.inBlock && !currentSec) {
      if (isTopLevelFieldStart(line)) {
        currentEx.inBlock = null
      } else {
        if (currentEx.inBlock === 'function') currentEx.sharedFunctionLines.push(line)
        else currentEx.sharedGeometryLines.push(line)
        continue
      }
    }

    // Table header (`* מבנה טבלה (עמודות: X, Y, Z):`) has a colon inside its
    // parenthetical, which FIELD_RE can't handle — its `[^:]+?` key stops at
    // the first `:`. Match this special-case shape BEFORE FIELD_RE so the
    // right block mode opens.
    if (currentSec) {
      const tm = line.match(TABLE_HEADER_RE)
      if (tm) {
        const cols = (tm[1] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        currentSec.tableHeaders = cols
        currentSec.inBlock = 'table'
        currentField = null
        continue
      }
    }

    // Top-level fields at the section/exercise level.
    const fm = line.match(FIELD_RE)
    if (fm) {
      const key = fm[1]
      const value = fm[2]
      if (currentSec) {
        const status = applySectionField(currentSec, key, value)
        if (status.kind === 'block-start') {
          currentField = null
          continue
        }
        if (status.kind === 'option' || status.kind === 'type') {
          currentField = null
          continue
        }
        if (status.kind === 'consumed') {
          currentField = status.slot
          continue
        }
        // Passthrough — the `* key: value` shape matched but the key isn't a
        // known field. If we're inside a multi-line field (e.g. `* פתרון מלא:`
        // followed by a `* נזהה את המבנה:` bullet), treat the whole raw line
        // as continuation of that field. Otherwise fall back to question.
        if (currentField) {
          appendToSlot(currentSec, currentField as SectionFieldSlot, line)
        } else {
          if (currentSec.question) currentSec.question += `\n${key}: ${value}`
          else currentSec.question = `${key}: ${value}`
        }
        continue
      }
      if (currentEx) {
        const status = applyExerciseField(currentEx, key, value)
        if (status.kind === 'block-start') {
          currentField = null
          continue
        }
        if (status.kind === 'consumed') {
          currentField = status.slot
          continue
        }
        // Passthrough — append to intro.
        currentEx.intro += currentEx.intro ? `\n${key}: ${value}` : `${key}: ${value}`
        continue
      }
      continue
    }

    // Bare non-field lines. Route to the currently-open field slot so a
    // multi-line `* פתרון מלא:` block doesn't spill into `question`.
    if (line.trim() === '') continue
    if (currentSec) {
      if (currentField && currentField !== 'intro') {
        appendToSlot(currentSec, currentField, line)
      } else {
        currentSec.question += currentSec.question ? `\n${line}` : line
      }
    } else if (currentEx) {
      currentEx.intro += currentEx.intro ? `\n${line}` : line
    }
  }

  flushExercise()
  return lesson
}
