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
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

import { parseGeometryDsl } from './parse-geometry-dsl'

export type QuestionTypeV2 =
  | { kind: 'mcq'; optionsCount: number }
  | { kind: 'free_response' }
  | { kind: 'table' }
  | { kind: 'unknown'; raw: string }

export interface TextOptionV2 {
  text: string
  correct: boolean
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
  /** Parsed DSL geometry from `שרטוט מותאם לסעיף`. Set only when the section has its own DSL block — never falls back to the exercise's shared geometry (that would double-emit the sketch, once via sharedBlocks and once as an attachment). */
  geometry?: GeometrySpecV1
  /** Raw SVG markup pulled from `שרטוט מותאם לסעיף` when the block was inline `<svg>` rather than DSL. Mutually exclusive with `geometry`. */
  svg?: string
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
const V2_SIGNATURE_RE = /\[\s*תרגיל\s+\S+\s*[-–]\s*נתוני\s*פתיחה\s*\]/
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

// Exercise header inside [ ... ] — accepts trailing tokens after the number so
// the header rest ("נתוני פתיחה" or a section-type label) can be captured.
const EXERCISE_HEADER_RE = /^\[\s*תרגיל\s+(\S+?)\s*[-–]\s*(.+?)\s*\]\s*$/
// Section header, either with or without a "תרגיל N -" prefix. The label is
// captured with a greedy-lazy pattern that allows extras like "1 ויחיד" or a
// comma-separated multi-label ("א', ב', ג', ד'") — anything up to the first
// " - question-type" tail (or the closing bracket if no tail is present).
const SECTION_HEADER_RE =
  /^\[\s*(?:תרגיל\s+\S+\s*[-–]\s*)?סעיף\s+(.+?)\s*(?:[-–]\s*(.+?))?\s*\]\s*$/
const FIELD_RE = /^\*\s+([^:]+?)\s*:\s*(.*)$/
const OPTION_FIELD_RE = /^אפשרות\s+(\d+)$/
const CORRECT_MARKER_RE = /\s*\[\s*תשובה\s+נכונה\s*\]\s*$/
const HEADER_LINE_RE = /^(קורס|פרק|שם השיעור)\s*[-–]\s*(.+)$/

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
    return { kind: 'mcq', optionsCount: count }
  }
  const hebrewMcq = t.match(/^בחירה\s+בין\s+(\d+)\s+אפשרויות\b/)
  if (hebrewMcq) return { kind: 'mcq', optionsCount: Number(hebrewMcq[1]) }
  if (/^fill[-\s]in\s+table$/i.test(t) || /^שאלת\s+השלמת\s+טבלה$/.test(t)) {
    return { kind: 'table' }
  }
  return { kind: 'unknown', raw }
}

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

interface MutableSectionV2 {
  questionNumber: string
  headerRest: string
  question: string
  hint?: string
  fullSolution?: string
  typeRaw: string
  options: TextOptionV2[]
  geometryLines: string[]
  inGeometry: boolean
}

interface MutableExerciseV2 {
  exerciseNumber: string
  headerRest: string
  intro: string
  sharedGeometryLines: string[]
  inGeometry: boolean
  sections: MutableSectionV2[]
}

function newExercise(num: string, headerRest: string): MutableExerciseV2 {
  return {
    exerciseNumber: num,
    headerRest,
    intro: '',
    sharedGeometryLines: [],
    inGeometry: false,
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
    geometryLines: [],
    inGeometry: false,
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type SectionFieldSlot = 'question' | 'hint' | 'fullSolution'
type ExerciseFieldSlot = 'intro'

type ApplySectionResult =
  | { kind: 'geometry-start' }
  | { kind: 'option' }
  | { kind: 'type' }
  | { kind: 'consumed'; slot: SectionFieldSlot }
  | { kind: 'passthrough' }

type ApplyExerciseResult =
  | { kind: 'geometry-start' }
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
    ex.inGeometry = true
    return { kind: 'geometry-start' }
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
    sec.inGeometry = true
    return { kind: 'geometry-start' }
  }
  const optionMatch = k.match(OPTION_FIELD_RE)
  if (optionMatch) {
    const trimmed = value.replace(CORRECT_MARKER_RE, '').trim()
    const correct = CORRECT_MARKER_RE.test(value)
    if (trimmed) sec.options.push({ text: trimmed, correct })
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
} {
  if (rawLines.length === 0) {
    return { warnings: [], hasContent: false }
  }
  const joined = rawLines.join('\n')
  const firstNonBlank = joined.replace(/^\s+/, '')
  if (/^<svg\b/i.test(firstNonBlank)) {
    return { svg: joined.trim(), warnings: [], hasContent: true }
  }
  const { spec, warnings, hasContent } = parseGeometryDsl(joined)
  return { spec: hasContent ? spec : undefined, warnings, hasContent }
}

function finalizeSection(sec: MutableSectionV2): TextSectionV2 {
  const { svg, spec, warnings, hasContent } = classifyBlockBody(sec.geometryLines)
  return {
    questionNumber: sec.questionNumber,
    headerRest: sec.headerRest,
    question: sec.question.trim(),
    hint: sec.hint?.trim() || undefined,
    fullSolution: sec.fullSolution?.trim() || undefined,
    type: classifyType(sec.typeRaw),
    options: sec.options,
    // Section geometry/svg is set ONLY when the section has its own block.
    // We deliberately do NOT fall back to the exercise-level shared sketch —
    // that would emit the same drawing twice (once via sharedBlocks, once
    // per section as an attachment).
    geometry: hasContent ? spec : undefined,
    svg: hasContent ? svg : undefined,
    geometryWarnings: warnings,
  }
}

function finalizeExercise(ex: MutableExerciseV2): TextExerciseV2 {
  const { svg, spec, warnings, hasContent } = classifyBlockBody(ex.sharedGeometryLines)
  return {
    exerciseNumber: ex.exerciseNumber,
    headerRest: ex.headerRest,
    intro: ex.intro.trim(),
    sharedGeometry: hasContent ? spec : undefined,
    sharedSvg: hasContent ? svg : undefined,
    sharedGeometryWarnings: warnings,
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
      // Unknown bracket header — ignore.
      continue
    }

    // Inside an in-flight geometry block, greedily consume indented content
    // until we hit a top-level field or a separator on the NEXT iteration.
    if (currentSec && currentSec.inGeometry) {
      if (isTopLevelFieldStart(line)) {
        currentSec.inGeometry = false
        // fall through to field-detection below
      } else {
        currentSec.geometryLines.push(line)
        continue
      }
    } else if (currentEx && currentEx.inGeometry && !currentSec) {
      if (isTopLevelFieldStart(line)) {
        currentEx.inGeometry = false
      } else {
        currentEx.sharedGeometryLines.push(line)
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
        if (status.kind === 'geometry-start') {
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
        if (status.kind === 'geometry-start') {
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
