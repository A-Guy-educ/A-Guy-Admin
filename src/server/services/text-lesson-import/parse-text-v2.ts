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
  /** Parsed geometry — either from `שרטוט מותאם לסעיף` or falling back to the exercise-level shared geometry. */
  geometry?: GeometrySpecV1
  geometryWarnings: string[]
}

export interface TextExerciseV2 {
  exerciseNumber: string
  /** Everything after the exercise header prefix. Usually "נתוני פתיחה" — kept as-is for downstream titling. */
  headerRest: string
  /** Free narrative pulled from the "* טקסט:" field. */
  intro: string
  /** Parsed shared geometry from "* שרטוט בסיס". */
  sharedGeometry?: GeometrySpecV1
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

const V2_SIGNATURE_RE = /\[\s+תרגיל\s+\S+\s*[-–]\s*נתוני\s*פתיחה\s+\]/
// `\b` is ASCII-only in JS regex and doesn't fire between Hebrew letters and
// non-letters, so anchor on explicit whitespace after "סעיף" instead.
const V2_SECTION_SIGNATURE_RE = /\[\s+(?:תרגיל\s+\S+\s*[-–]\s*)?סעיף\s/

export function isV2Format(raw: string): boolean {
  return V2_SIGNATURE_RE.test(raw) || V2_SECTION_SIGNATURE_RE.test(raw)
}

// ---------------------------------------------------------------------------
// Line-classification regexes
// ---------------------------------------------------------------------------

// Exercise header inside [ ... ] — accepts trailing tokens after the number so
// the header rest ("נתוני פתיחה" or a section-type label) can be captured.
const EXERCISE_HEADER_RE = /^\[\s*תרגיל\s+(\S+?)\s*[-–]\s*(.+?)\s*\]\s*$/
// Section header, either with or without a "תרגיל N -" prefix.
const SECTION_HEADER_RE =
  /^\[\s*(?:תרגיל\s+\S+\s*[-–]\s*)?סעיף\s+(\S+?)\s*(?:[-–]\s*(.+?))?\s*\]\s*$/
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

/**
 * Field names on the exercise level that map directly onto structured intro/
 * geometry state. Anything else is treated as free-form narrative appended
 * to the intro so nothing is silently lost.
 */
function applyExerciseField(
  ex: MutableExerciseV2,
  key: string,
  value: string,
): 'geometry-start' | 'consumed' | 'passthrough' {
  const k = key.trim()
  if (k === 'טקסט') {
    ex.intro = ex.intro ? `${ex.intro}\n${value}` : value
    return 'consumed'
  }
  if (k.startsWith('שרטוט בסיס') || k.startsWith('שרטוט בסיסי')) {
    ex.inGeometry = true
    return 'geometry-start'
  }
  return 'passthrough'
}

function applySectionField(
  sec: MutableSectionV2,
  key: string,
  value: string,
): 'geometry-start' | 'consumed' | 'passthrough' {
  const k = key.trim()
  if (k === 'סוג השאלה' || k === 'סוג תרגיל') {
    sec.typeRaw = value
    return 'consumed'
  }
  if (k === 'הנחיה' || k === 'תוכן השאלה' || k === 'טקסט נלווה') {
    sec.question = sec.question ? `${sec.question}\n${value}` : value
    return 'consumed'
  }
  if (k === 'רמז') {
    sec.hint = sec.hint ? `${sec.hint}\n${value}` : value
    return 'consumed'
  }
  if (k === 'פתרון מלא') {
    sec.fullSolution = sec.fullSolution ? `${sec.fullSolution}\n${value}` : value
    return 'consumed'
  }
  if (k.startsWith('שרטוט מותאם') || k.startsWith('שרטוט')) {
    sec.inGeometry = true
    return 'geometry-start'
  }
  const optionMatch = k.match(OPTION_FIELD_RE)
  if (optionMatch) {
    const trimmed = value.replace(CORRECT_MARKER_RE, '').trim()
    const correct = CORRECT_MARKER_RE.test(value)
    if (trimmed) sec.options.push({ text: trimmed, correct })
    return 'consumed'
  }
  return 'passthrough'
}

function finalizeSection(sec: MutableSectionV2, sharedGeom?: GeometrySpecV1): TextSectionV2 {
  const { spec, warnings, hasContent } = sec.geometryLines.length
    ? parseGeometryDsl(sec.geometryLines.join('\n'))
    : { spec: undefined as GeometrySpecV1 | undefined, warnings: [] as string[], hasContent: false }
  return {
    questionNumber: sec.questionNumber,
    headerRest: sec.headerRest,
    question: sec.question.trim(),
    hint: sec.hint?.trim() || undefined,
    fullSolution: sec.fullSolution?.trim() || undefined,
    type: classifyType(sec.typeRaw),
    options: sec.options,
    geometry: hasContent ? spec : sharedGeom,
    geometryWarnings: warnings,
  }
}

function finalizeExercise(ex: MutableExerciseV2): TextExerciseV2 {
  const { spec, warnings, hasContent } = ex.sharedGeometryLines.length
    ? parseGeometryDsl(ex.sharedGeometryLines.join('\n'))
    : { spec: undefined as GeometrySpecV1 | undefined, warnings: [] as string[], hasContent: false }
  const shared = hasContent ? spec : undefined
  return {
    exerciseNumber: ex.exerciseNumber,
    headerRest: ex.headerRest,
    intro: ex.intro.trim(),
    sharedGeometry: shared,
    sharedGeometryWarnings: warnings,
    sections: ex.sections.map((s) => finalizeSection(s, shared)),
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

export function parseTextLessonV2(raw: string): TextLessonV2 {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')

  const lesson: TextLessonV2 = { exercises: [] }
  let currentEx: MutableExerciseV2 | null = null
  let currentSec: MutableSectionV2 | null = null

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
        currentSec = newSection(secMatch[1] ?? '', (secMatch[2] ?? '').trim())
        continue
      }
      const exMatch = bracketed.match(EXERCISE_HEADER_RE)
      if (exMatch) {
        const num = exMatch[1]
        const rest = exMatch[2].trim()
        flushExercise()
        currentEx = newExercise(num, rest)
        currentSec = null
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
        if (status === 'geometry-start') continue
        if (status === 'consumed') continue
        // Passthrough — record as free-form narrative on the question so nothing
        // is silently lost.
        if (currentSec.question) currentSec.question += `\n${key}: ${value}`
        else currentSec.question = `${key}: ${value}`
        continue
      }
      if (currentEx) {
        const status = applyExerciseField(currentEx, key, value)
        if (status === 'geometry-start') continue
        if (status === 'consumed') continue
        // Passthrough — append to intro.
        currentEx.intro += currentEx.intro ? `\n${key}: ${value}` : `${key}: ${value}`
        continue
      }
      continue
    }

    // Free-text continuation lines (rare in v2). Attach to the current
    // section's question or the current exercise's intro so authors can
    // wrap long lines without losing content.
    if (line.trim() === '') continue
    if (currentSec) {
      currentSec.question += currentSec.question ? `\n${line}` : line
    } else if (currentEx) {
      currentEx.intro += currentEx.intro ? `\n${line}` : line
    }
  }

  flushExercise()
  return lesson
}
