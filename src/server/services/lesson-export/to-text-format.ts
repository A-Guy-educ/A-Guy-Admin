/**
 * Serializes a canonical lesson export (see to-canonical-format.ts) into the
 * v2 plain-text lesson format consumed by /admin/lesson-json-import (.txt).
 *
 * This is the inverse of parseTextLessonV2 in
 * src/server/services/text-lesson-import/parse-text-v2.ts — anything emitted
 * here must round-trip through that parser and convertTextExerciseV2ToSections.
 *
 * Shape produced:
 *
 *   שם השיעור - <topic>
 *
 *   =========================================
 *   [ תרגיל 1 - נתוני פתיחה ]
 *   =========================================
 *   * טקסט: <exercise intro>
 *   * שרטוט בסיס:
 *     --- נקודות --- …
 *
 *   =========================================
 *   [ תרגיל 1 - סעיף א - Fill-in Table ]
 *   =========================================
 *   * סוג השאלה: Fill-in Table
 *   * הנחיה: <question text>
 *   * שרטוט עצמאי לסעיף:                    (standalone block before the question)
 *     <svg …> | --- נקודות --- …
 *   * שרטוט מותאם לסעיף:                    (attached to the question block)
 *     --- נקודות --- …
 *   * מבנה טבלה (עמודות: שלב, טענה, נימוק):
 *     * שורה 1 | שלב: 1 | טענה: … | נימוק: [ שדה ריק - להשלמה: נתון ]
 *   * אפשרות N: <text> [תשובה נכונה]       (choice questions)
 *   * צמד N: <left> <---> <right>          (matching questions)
 *   * רמז: <hint>
 *   * פתרון מלא: <full solution>
 */
import type {
  CanonicalLessonExport,
  CanonicalQuestionType,
  CanonicalSection,
  CanonicalTable,
  CanonicalTextContent,
} from './to-canonical-format'

const EQ_RULE = '='.repeat(41)

const TYPE_LABEL: Record<CanonicalQuestionType, string> = {
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  open_ended: 'Open Ended',
  matching: 'Matching',
  table: 'Fill-in Table',
}

function hasText(c: CanonicalTextContent | undefined): boolean {
  return !!c && typeof c.text === 'string' && c.text.trim().length > 0
}

function oneLine(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, ' ').trim()
}

/**
 * Emits a `* <field>: <value>` line, allowing multi-line values. The v2
 * parser appends bare lines after a field marker to that field.
 */
function emitField(name: string, value: string, out: string[]): void {
  const trimmed = value.replace(/\r\n/g, '\n').trim()
  if (!trimmed) return
  const lines = trimmed.split('\n')
  out.push(`* ${name}: ${lines[0]}`)
  for (let i = 1; i < lines.length; i++) out.push(lines[i])
}

/**
 * Emit the visuals of a slot. Geometry rows start with `* `, which the parser
 * would read as a new top-level field at column 0, so geometry/SVG bodies are
 * indented. Function DSL (`%%%` fences) goes under its own `גרף` marker.
 */
function emitVisuals(
  data: CanonicalTextContent,
  sketchField: string,
  graphField: string,
  out: string[],
): void {
  const geometry = data.geometryDsl?.trim() || (data.functionDsl ? '' : data.svg?.trim())
  if (geometry) {
    out.push(`* ${sketchField}:`)
    for (const line of geometry.split('\n')) out.push(line ? `  ${line}` : line)
  }
  const fn = data.functionDsl?.trim()
  if (fn) {
    out.push(`* ${graphField}:`)
    out.push(...fn.split('\n'))
  }
}

function resolveType(section: CanonicalSection): CanonicalQuestionType {
  if (section.question_type) return section.question_type
  return hasText(section.correct_option) ? 'single_choice' : 'open_ended'
}

function resolveOptions(section: CanonicalSection): Array<{ text: string; correct: boolean }> {
  if (section.options && section.options.length > 0) return section.options
  const out: Array<{ text: string; correct: boolean }> = []
  if (hasText(section.correct_option))
    out.push({ text: section.correct_option.text, correct: true })
  for (const w of section.wrong_options) {
    if (hasText(w)) out.push({ text: w.text, correct: false })
  }
  return out
}

/**
 * Rows are labelled by index; every column (including the first) is emitted
 * by name so labels with spaces don't break the parser's `שורה <token>` rule.
 */
function emitTable(table: CanonicalTable, out: string[]): void {
  if (table.headers.length === 0 || table.rowsData.length === 0) return
  out.push(`* מבנה טבלה (עמודות: ${table.headers.join(', ')}):`)
  table.rowsData.forEach((row, r) => {
    const cells = table.headers.map((header, c) => {
      const answer = table.answers[`${r}-${c}`]
      if (typeof answer === 'string' && answer.trim()) {
        return `${header}: [ שדה ריק - להשלמה: ${oneLine(answer)} ]`
      }
      return `${header}: ${oneLine(row[c] ?? '')}`
    })
    out.push(`  * שורה ${r + 1} | ${cells.join(' | ')}`)
  })
}

function emitSection(exerciseNumber: string, section: CanonicalSection, out: string[]): void {
  const type = resolveType(section)
  const label = TYPE_LABEL[type]

  out.push('')
  out.push(EQ_RULE)
  out.push(`[ תרגיל ${exerciseNumber} - סעיף ${section.question_number || '?'} - ${label} ]`)
  out.push(EQ_RULE)
  out.push(`* סוג השאלה: ${label}`)

  // Section-level intro text has no slot of its own in v2 — prepend it to
  // the question so nothing is lost.
  const introText = section.section_data.text?.trim() ?? ''
  const questionText = section.question.text?.trim() ?? ''
  emitField('הנחיה', [introText, questionText].filter(Boolean).join('\n\n'), out)

  // Standalone section blocks vs. the question's own attachment use separate
  // markers so reimport rebuilds the same block layout.
  emitVisuals(section.section_data, 'שרטוט עצמאי לסעיף', 'גרף עצמאי לסעיף', out)
  emitVisuals(section.question, 'שרטוט מותאם לסעיף', 'גרף מותאם לסעיף', out)

  if (type === 'single_choice' || type === 'multiple_choice') {
    resolveOptions(section).forEach((o, i) => {
      out.push(`* אפשרות ${i + 1}: ${oneLine(o.text)}${o.correct ? ' [תשובה נכונה]' : ''}`)
    })
  } else if (type === 'matching') {
    ;(section.matching_pairs ?? []).forEach((p, i) => {
      out.push(`* צמד ${i + 1}: ${oneLine(p.left)} <---> ${oneLine(p.right)}`)
    })
  } else if (type === 'table' && section.table) {
    emitTable(section.table, out)
  }

  if (hasText(section.hint)) emitField('רמז', section.hint.text, out)
  if (hasText(section.full_solution)) emitField('פתרון מלא', section.full_solution.text, out)
  else if (hasText(section.solution)) emitField('פתרון מלא', section.solution.text, out)
}

export function serializeLessonToText(canonical: CanonicalLessonExport): string {
  const out: string[] = []

  if (canonical.topic) out.push(`שם השיעור - ${canonical.topic}`)

  for (const ex of canonical.exercises) {
    out.push('')
    out.push(EQ_RULE)
    out.push(`[ תרגיל ${ex.exercise_number} - נתוני פתיחה ]`)
    out.push(EQ_RULE)

    const data = ex.exercise_content.data
    emitField('טקסט', data.text ?? '', out)
    emitVisuals(data, 'שרטוט בסיס', 'גרף בסיס', out)

    for (const section of ex.exercise_content.sections) {
      emitSection(ex.exercise_number, section, out)
    }
  }

  out.push('')
  return out.join('\n')
}
