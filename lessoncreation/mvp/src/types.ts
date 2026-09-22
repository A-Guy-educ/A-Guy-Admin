/**
 * Canonical model the validator operates on. Both the DB-dump adapter
 * (parse-dump.ts, used for regression) and — later — the v2-text adapter
 * feed this shape, so the rules don't care where a lesson came from.
 */

export interface RichText {
  value: string
}

export interface McqOption {
  id: string
  text: string
}

export interface McqBlock {
  kind: 'mcq'
  blockId: string
  prompt: RichText
  options: McqOption[]
  correctOptionIds: string[]
  hint?: RichText
  solution?: RichText
  fullSolution?: RichText
}

export interface FreeResponseBlock {
  kind: 'free_response'
  blockId: string
  prompt: RichText
  acceptedAnswers: string[]
  hint?: RichText
  solution?: RichText
  fullSolution?: RichText
}

export interface RichTextBlock {
  kind: 'rich_text'
  blockId: string
  value: string
}

export interface SvgBlock {
  kind: 'svg'
  blockId: string
  svg: string
}

export type Block = McqBlock | FreeResponseBlock | RichTextBlock | SvgBlock

export interface ExerciseModel {
  /** 1-based position in the lesson. */
  index: number
  /** Free-text title from the dump header (may be "תרגיל N" or a real name). */
  title: string
  blocks: Block[]
}

export interface LessonModel {
  id: string
  title: string
  type: string
  chapter: string
  course: string
  exercises: ExerciseModel[]
}

// --------------------------------------------------------------------------
// Findings — mirror the shape used in ../lessonassesment/*.md so the report
// renderer can produce human-comparable Hebrew markdown.
// --------------------------------------------------------------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface Finding {
  severity: Severity
  ruleId: string
  /** "תרגיל N / בלוק M" — human-readable location string in Hebrew. */
  location: string
  /** One-line title of the finding, Hebrew. */
  title: string
  /** Evidence quote or JSON snippet — verbatim so a reviewer can locate it. */
  evidence: string
  /** Explanation of why this is wrong, Hebrew. */
  explanation: string
}

export interface ValidationReport {
  lesson: LessonModel
  findings: Finding[]
  summary: Record<Severity, number>
}
