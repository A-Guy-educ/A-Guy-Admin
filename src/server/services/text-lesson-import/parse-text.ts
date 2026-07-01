/**
 * Parser for the plain-text lesson format used by the curriculum-authoring
 * team. Files look like:
 *
 *   [optional header lines: קורס/פרק/שם השיעור]
 *
 *   ================================================================================
 *   תרגיל 1 – מנחה: <subtopic>
 *   ================================================================================
 *   <intro paragraph(s)>
 *   * שרטוט:
 *   <svg ...>...</svg>
 *   ענו על הסעיפים הבאים:
 *
 *   --------------------------------------------------------------------------------
 *   [תרגיל 1 - סעיף א]
 *   --------------------------------------------------------------------------------
 *   * תוכן השאלה: <question>
 *   * אופציות:
 *     - <option1>
 *     - <option2>
 *   * פתרון נכון: <correct>
 *   * רמז: <hint>
 *   * פתרון מלא: <full solution>
 *   * סוג תרגיל: <type>
 *
 * The parser is a small line-driven state machine. It does no semantic
 * mapping; it just produces a typed structure that the converter consumes.
 */

export type TextExerciseType =
  | { kind: 'mcq'; optionsCount: number }
  | { kind: 'matching'; optionsCount: number }
  | { kind: 'free_response' }
  | { kind: 'unknown'; raw: string }

export interface TextSection {
  /** Hebrew section letter, e.g. "א", "ב". May be absent. */
  questionNumber: string
  question: string
  options: string[]
  correctAnswer: string
  hint?: string
  fullSolution?: string
  type: TextExerciseType
}

export interface TextExercise {
  exerciseNumber: string
  /** The text after the category's colon on the exercise header line
   * (e.g. after `מנחה:` / `בסיס:` / `הבנה:` / `שילוב:` / `חזרה מסכמת:`). */
  subtopic: string
  /** Free narrative the teacher gives before the questions. May be empty. */
  intro: string
  /** Raw inline SVG markup if present. */
  svg?: string
  sections: TextSection[]
}

export interface TextLesson {
  /** Pulled from "שם השיעור - ..." if present, otherwise empty. */
  lessonName?: string
  exercises: TextExercise[]
}

// Exercise headers look like `תרגיל N – <category>: <subtopic>` where the
// category is one of מנחה/בסיס/הבנה/שילוב/חזרה מסכמת/etc. We don't restrict
// it — anything up to the first `:` after the en-dash counts as the category,
// and the rest is the subtopic.
const EXERCISE_HEADER_RE = /^תרגיל\s+([^\s–-]+)\s*[–-]\s*[^:]+:\s*(.*)$/
// The section header uses either en-dash or hyphen, matching the exercise
// header regex above. Files authored with en-dashed section titles were
// previously dropped silently.
const SECTION_HEADER_RE = /^\[תרגיל\s+([^\s–-]+)\s*[–-]\s*סעיף\s+(.+?)\]$/
const FIELD_RE = /^\*\s*([^:]+):\s*(.*)$/
const OPTION_RE = /^\s+-\s+(.+)$/
const SVG_START_RE = /^<svg\b/i
const SVG_END_RE = /<\/svg>\s*$/i
const HEADER_LINE_RE = /^(קורס|פרק|שם השיעור)\s*-\s*(.+)$/

const isSeparator = (line: string, ch: string) => {
  const trimmed = line.trim()
  return trimmed.length >= 10 && [...trimmed].every((c) => c === ch)
}
const isEqSep = (line: string) => isSeparator(line, '=')
const isDashSep = (line: string) => isSeparator(line, '-')

function classifyType(raw: string): TextExerciseType {
  const t = raw.trim()
  if (!t) return { kind: 'unknown', raw }
  // "בחירה בין N אפשרויות" — optionally followed by parenthetical notes
  const mcq = t.match(/^בחירה\s+בין\s+(\d+)\s+אפשרויות\b/)
  if (mcq) return { kind: 'mcq', optionsCount: Number(mcq[1]) }
  // "התאמה בין N אפשרויות" — same allowance
  const match = t.match(/^התאמה\s+בין\s+(\d+)\s+אפשרויות\b/)
  if (match) return { kind: 'matching', optionsCount: Number(match[1]) }
  if (t === 'תשובה פתוחה') return { kind: 'free_response' }
  return { kind: 'unknown', raw }
}

interface MutableSection {
  questionNumber: string
  fields: Record<string, string[]>
  options: string[]
}

interface MutableExercise {
  exerciseNumber: string
  subtopic: string
  introLines: string[]
  svgLines: string[]
  inSvg: boolean
  sections: MutableSection[]
}

function newExercise(num: string, subtopic: string): MutableExercise {
  return {
    exerciseNumber: num,
    subtopic,
    introLines: [],
    svgLines: [],
    inSvg: false,
    sections: [],
  }
}

function newSection(num: string): MutableSection {
  return { questionNumber: num, fields: {}, options: [] }
}

function appendField(section: MutableSection, name: string, value: string) {
  const key = name.trim()
  if (!section.fields[key]) section.fields[key] = []
  if (value !== '') section.fields[key].push(value)
}

function finalizeSection(ms: MutableSection): TextSection {
  const get = (name: string) => (ms.fields[name] ?? []).join('\n').trim()
  return {
    questionNumber: ms.questionNumber,
    question: get('תוכן השאלה'),
    options: ms.options,
    correctAnswer: get('פתרון נכון'),
    hint: get('רמז') || undefined,
    fullSolution: get('פתרון מלא') || undefined,
    type: classifyType(get('סוג תרגיל')),
  }
}

function finalizeExercise(me: MutableExercise): TextExercise {
  return {
    exerciseNumber: me.exerciseNumber,
    subtopic: me.subtopic.trim(),
    intro: me.introLines.join('\n').trim(),
    svg: me.svgLines.length > 0 ? me.svgLines.join('\n').trim() : undefined,
    sections: me.sections.map(finalizeSection),
  }
}

export function parseTextLesson(raw: string): TextLesson {
  // Normalize line endings, strip BOM
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')

  const lesson: TextLesson = { exercises: [] }
  let currentEx: MutableExercise | null = null
  let currentSection: MutableSection | null = null
  let currentField: string | null = null
  let phase: 'header' | 'exercise_intro' | 'svg' | 'section' = 'header'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Top-level separators (=== or ---). The line BEFORE/AFTER provides context.
    if (isEqSep(line)) {
      // Look ahead for an exercise header
      const next = lines[i + 1] ?? ''
      const m = next.match(EXERCISE_HEADER_RE)
      if (m) {
        // Close any in-flight exercise/section
        if (currentSection && currentEx) {
          currentEx.sections.push(currentSection)
          currentSection = null
        }
        if (currentEx) lesson.exercises.push(finalizeExercise(currentEx))
        currentEx = newExercise(m[1], m[2])
        currentField = null
        phase = 'exercise_intro'
        // Skip header line + the closing === on the next iteration
        i++
        const closing = lines[i + 1] ?? ''
        if (isEqSep(closing)) i++
        continue
      }
      // Stray separator — ignore
      continue
    }

    if (isDashSep(line)) {
      const next = lines[i + 1] ?? ''
      const m = next.match(SECTION_HEADER_RE)
      if (m) {
        if (currentSection && currentEx) currentEx.sections.push(currentSection)
        currentSection = newSection(m[2])
        currentField = null
        phase = 'section'
        i++
        const closing = lines[i + 1] ?? ''
        if (isDashSep(closing)) i++
        continue
      }
      continue
    }

    // Optional file header lines
    if (phase === 'header') {
      const hm = line.match(HEADER_LINE_RE)
      if (hm) {
        // Only `שם השיעור` currently drives downstream (deriveLessonTitle).
        // Course and chapter are recognized so we don't misinterpret them as
        // narrative, but they aren't stored — chapter comes from the admin
        // dropdown and course is inferred from the chapter.
        if (hm[1] === 'שם השיעור') lesson.lessonName = hm[2].trim()
        continue
      }
      // Blank lines and unknown content in the header zone are skipped
      if (line.trim() === '') continue
      continue
    }

    // Inside an exercise but BEFORE the first section ([תרגיל N - סעיף …])
    if (phase === 'exercise_intro' || phase === 'svg') {
      if (!currentEx) continue

      if (currentEx.inSvg) {
        currentEx.svgLines.push(line)
        if (SVG_END_RE.test(line)) {
          currentEx.inSvg = false
          phase = 'exercise_intro'
        }
        continue
      }

      if (SVG_START_RE.test(line.trim())) {
        currentEx.inSvg = true
        currentEx.svgLines.push(line)
        if (SVG_END_RE.test(line)) currentEx.inSvg = false
        phase = 'svg'
        continue
      }

      // "* שרטוט:" marker — ignore, the SVG block follows
      if (line.trim() === '* שרטוט:') continue

      // "ענו על הסעיפים הבאים:" — ignore
      if (line.trim() === 'ענו על הסעיפים הבאים:') continue

      // Anything else is intro narrative
      currentEx.introLines.push(line)
      continue
    }

    // Inside a section
    if (phase === 'section' && currentSection) {
      const fm = line.match(FIELD_RE)
      if (fm) {
        currentField = fm[1].trim()
        const value = fm[2]
        appendField(currentSection, currentField, value)
        continue
      }

      const om = line.match(OPTION_RE)
      if (om && currentField === 'אופציות') {
        currentSection.options.push(om[1].trim())
        continue
      }

      // Continuation lines for the current field (e.g. multi-line full solution)
      if (currentField && line.trim() !== '') {
        appendField(currentSection, currentField, line)
        continue
      }
    }
  }

  // Final close
  if (currentSection && currentEx) currentEx.sections.push(currentSection)
  if (currentEx) lesson.exercises.push(finalizeExercise(currentEx))

  return lesson
}
