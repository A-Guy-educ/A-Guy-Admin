/**
 * Render a ValidationReport as Hebrew markdown, matching the shape of the
 * human-authored reports in ../lessonassesment/*.md so a reviewer reads
 * both in the same mental model.
 */
import type { ValidationReport } from './types.js'

function severityBadge(sev: string): string {
  return `[${sev}]`
}

export function renderReport(report: ValidationReport): string {
  const { lesson, findings, summary } = report

  const header = [
    `# בדיקת שיעור (אוטומטית): ${lesson.title}`,
    ``,
    `**Lesson ID:** ${lesson.id} **סוג:** ${lesson.type} **תרגילים:** ${lesson.exercises.length}`,
    ``,
    `## סיכום`,
    ``,
    `- קריטיים: ${summary.CRITICAL} | גבוהים: ${summary.HIGH} | בינוניים: ${summary.MEDIUM} | נמוכים: ${summary.LOW}`,
    ``,
  ].join('\n')

  if (findings.length === 0) {
    return `${header}## ממצאים\n\nאין ממצאים — הבדיקה עברה בהצלחה.\n`
  }

  const body = findings
    .map(
      (f) =>
        [
          `### ${severityBadge(f.severity)} ${f.location} — ${f.title}`,
          ``,
          `- **כלל:** \`${f.ruleId}\``,
          `- **ראיה:** ${f.evidence}`,
          `- **הסבר:** ${f.explanation}`,
          ``,
        ].join('\n'),
    )
    .join('\n')

  return `${header}## ממצאים\n\n${body}`
}
