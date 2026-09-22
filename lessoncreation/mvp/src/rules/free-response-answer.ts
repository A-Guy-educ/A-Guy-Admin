/**
 * CRITICAL rule: free-response `acceptedAnswers` must be non-empty and not
 * the literal `["?"]` placeholder that the auditor found in 15+ places
 * (exercises 6-8 in מספרים-מכוונים-מבוא, exercise 7 completely, etc.).
 *
 * When acceptedAnswers is empty or `?`, no student answer can ever be
 * marked correct — the auto-check is broken by construction.
 */
import type { Finding, LessonModel } from '../types.js'

const RULE_ID = 'free-response-answer'

export function runFreeResponseAnswer(lesson: LessonModel): Finding[] {
  const findings: Finding[] = []

  for (const exercise of lesson.exercises) {
    exercise.blocks.forEach((block, i) => {
      if (block.kind !== 'free_response') return

      const trimmed = block.acceptedAnswers.map((a) => a.trim()).filter(Boolean)

      if (trimmed.length === 0) {
        findings.push({
          severity: 'CRITICAL',
          ruleId: RULE_ID,
          location: `תרגיל ${exercise.index} / בלוק ${i + 1}`,
          title: 'acceptedAnswers ריק — אין תשובה תקינה לבדיקה',
          evidence: `acceptedAnswers=${JSON.stringify(block.acceptedAnswers)}`,
          explanation:
            'שאלה פתוחה ללא תשובה מקובלת. תלמידים לא יסומנו כענו נכון בשום מקרה. יש להוסיף לפחות תשובה אחת ב-acceptedAnswers.',
        })
        return
      }

      // "?" is the pipeline's placeholder from the JSON template.
      const allPlaceholder = trimmed.every((a) => a === '?' || a === '؟')
      if (allPlaceholder) {
        findings.push({
          severity: 'CRITICAL',
          ruleId: RULE_ID,
          location: `תרגיל ${exercise.index} / בלוק ${i + 1}`,
          title: 'acceptedAnswers = "?" — placeholder לא הוחלף בתשובה אמיתית',
          evidence: `acceptedAnswers=${JSON.stringify(block.acceptedAnswers)}`,
          explanation:
            'ערך ה-placeholder "?" נשאר במקום התשובה. תלמידים לא יוכלו לענות נכון. יש להחליף בתשובה אמיתית או בטווח תשובות מקובלות.',
        })
      }
    })
  }

  return findings
}
