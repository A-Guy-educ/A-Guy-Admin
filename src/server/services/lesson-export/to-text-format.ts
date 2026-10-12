/**
 * Serializes a canonical lesson export (see to-canonical-format.ts) into the
 * v1 plain-text lesson format consumed by /admin/lesson-json-import (.txt).
 *
 * This is the inverse of parseTextLesson in
 * src/server/services/text-lesson-import/parse-text.ts — anything emitted here
 * must round-trip through that parser.
 *
 * Shape produced:
 *
 *   שם השיעור - <topic>
 *   קורס - <class>              (only if class is non-empty)
 *
 *   ================================================================================
 *   תרגיל 1 – <lesson topic>
 *   ================================================================================
 *   <exercise intro text>
 *   <exercise-level svg block(s)>
 *
 *   --------------------------------------------------------------------------------
 *   [תרגיל 1 - סעיף א]
 *   --------------------------------------------------------------------------------
 *   <section-level svg block, if any>
 *   * תוכן השאלה: <question text>
 *   * אופציות:
 *     - <option>
 *     - <option>
 *   * פתרון נכון: <correct option text>
 *   * רמז: <hint>
 *   * פתרון מלא: <full solution>
 */
import type {
  CanonicalLessonExport,
  CanonicalSection,
  CanonicalTextContent,
} from './to-canonical-format'

const EQ_RULE = '='.repeat(80)
const DASH_RULE = '-'.repeat(80)

function hasText(c: CanonicalTextContent | undefined): boolean {
  return !!c && typeof c.text === 'string' && c.text.trim().length > 0
}

function hasSvg(c: CanonicalTextContent | undefined): boolean {
  return !!c && typeof c.svg === 'string' && c.svg.trim().length > 0
}

/**
 * Emits a `* <field>: <value>` line, allowing multi-line values. The v1
 * parser treats any non-empty line after a field marker as a continuation
 * line, so additional lines flow through naturally.
 */
function emitField(name: string, value: string, out: string[]): void {
  const trimmed = value.replace(/\r\n/g, '\n').trim()
  if (!trimmed) return
  const lines = trimmed.split('\n')
  out.push(`* ${name}: ${lines[0]}`)
  for (let i = 1; i < lines.length; i++) out.push(lines[i])
}

function emitSection(exerciseNumber: string, section: CanonicalSection, out: string[]): void {
  out.push('')
  out.push(DASH_RULE)
  out.push(`[תרגיל ${exerciseNumber} - סעיף ${section.question_number || ''}]`.trim())
  out.push(DASH_RULE)

  if (hasSvg(section.section_data)) {
    out.push(section.section_data.svg)
  }

  // The v1 parser ignores bare lines inside a section before the first
  // `* field:` marker, so section-level intro text would be lost if emitted
  // on its own. Prepend it to the question text (separated by a blank line)
  // to keep the round-trip lossless.
  const introText = section.section_data.text?.trim() ?? ''
  const questionText = section.question.text?.trim() ?? ''
  const combinedQuestion = introText
    ? questionText
      ? `${introText}\n\n${questionText}`
      : introText
    : questionText
  emitField('תוכן השאלה', combinedQuestion, out)

  const correctText = section.correct_option.text?.trim() ?? ''
  const wrongTexts = section.wrong_options.map((o) => o.text?.trim() ?? '').filter(Boolean)

  if (correctText || wrongTexts.length > 0) {
    out.push('* אופציות:')
    if (correctText) out.push(`  - ${correctText}`)
    for (const w of wrongTexts) out.push(`  - ${w}`)
    if (correctText) emitField('פתרון נכון', correctText, out)
  }

  if (hasText(section.hint)) emitField('רמז', section.hint.text, out)
  if (hasText(section.full_solution)) emitField('פתרון מלא', section.full_solution.text, out)
  else if (hasText(section.solution)) emitField('פתרון מלא', section.solution.text, out)
}

export function serializeLessonToV1Text(canonical: CanonicalLessonExport): string {
  const out: string[] = []

  if (canonical.topic) out.push(`שם השיעור - ${canonical.topic}`)
  if (canonical.class) out.push(`קורס - ${canonical.class}`)
  if (out.length > 0) out.push('')

  for (const ex of canonical.exercises) {
    out.push(EQ_RULE)
    // The v1 parser requires `תרגיל N – <subtopic>` with a dash — a bare
    // `תרגיל N` is skipped silently. Canonical form doesn't preserve the
    // original authoring subtopic, so fall back to the lesson topic (and
    // ultimately the exercise number) to keep the header parseable.
    const subtopic = canonical.topic?.trim() || `תרגיל ${ex.exercise_number}`
    out.push(`תרגיל ${ex.exercise_number} – ${subtopic}`)
    out.push(EQ_RULE)

    const introText = ex.exercise_content.data.text?.trim() ?? ''
    if (introText) out.push(introText)

    const introSvg = ex.exercise_content.data.svg?.trim() ?? ''
    if (introSvg) {
      if (introText) out.push('')
      out.push(introSvg)
    }

    for (const section of ex.exercise_content.sections) {
      emitSection(ex.exercise_number, section, out)
    }

    out.push('')
  }

  return out.join('\n')
}
