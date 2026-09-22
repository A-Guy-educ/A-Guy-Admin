/**
 * Validator orchestrator — runs every rule against a LessonModel and
 * returns a ValidationReport.
 *
 * Rules are pure functions of the lesson. Adding a rule = add an import
 * and push its findings. No config, no plugin registry — MVP.
 */
import { runExerciseHasQuestions } from './rules/exercise-has-questions.js'
import { runFreeResponseAnswer } from './rules/free-response-answer.js'
import { runMcqCorrectOption } from './rules/mcq-correct-option.js'
import { runSectionHeaders } from './rules/section-headers.js'
import type { Finding, LessonModel, Severity, ValidationReport } from './types.js'

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

function emptySummary(): Record<Severity, number> {
  return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
}

function bySeverityThenLocation(a: Finding, b: Finding): number {
  const sev = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  if (sev !== 0) return sev
  return a.location.localeCompare(b.location, 'he')
}

export function validate(lesson: LessonModel): ValidationReport {
  const findings: Finding[] = [
    ...runMcqCorrectOption(lesson),
    ...runFreeResponseAnswer(lesson),
    ...runSectionHeaders(lesson),
    ...runExerciseHasQuestions(lesson),
  ].sort(bySeverityThenLocation)

  const summary = emptySummary()
  for (const f of findings) summary[f.severity] += 1

  return { lesson, findings, summary }
}
