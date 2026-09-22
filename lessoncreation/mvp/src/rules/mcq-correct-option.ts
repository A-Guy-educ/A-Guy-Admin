/**
 * CRITICAL rule: MCQ's `correctOptionIds`-marked option must match the
 * lesson's `solution` field for the same block. Firing the most-common
 * failure mode in lessonassesment/ (40+ occurrences: `correctOptionIds`
 * pointing to a distractor while `solution` shows the actual right answer).
 */
import { answersEqual, normalizeAnswer } from '../normalize.js'
import type { ExerciseModel, Finding, LessonModel, McqBlock } from '../types.js'

const RULE_ID = 'mcq-correct-option'

function checkBlock(
  lesson: LessonModel,
  exercise: ExerciseModel,
  block: McqBlock,
  blockPosition: number,
): Finding | null {
  // Skip blocks without a solution — nothing to compare against.
  if (!block.solution?.value) return null
  // Skip multi-select (rare in this corpus, would need different logic).
  if (block.correctOptionIds.length !== 1) return null

  const correctId = block.correctOptionIds[0]
  const correctOption = block.options.find((o) => o.id === correctId)

  if (!correctOption) {
    return {
      severity: 'CRITICAL',
      ruleId: RULE_ID,
      location: `תרגיל ${exercise.index} / בלוק ${blockPosition}`,
      title: 'correctOptionIds מצביע ל-id שאינו קיים ברשימת האפשרויות',
      evidence: `correctOptionIds=[${correctId}] אך אין אפשרות תואמת ברשימה`,
      explanation: 'ה-MCQ מציין תשובה נכונה על פי id שאינו מופיע ברשימת האפשרויות של הבלוק.',
    }
  }

  if (!answersEqual(correctOption.text, block.solution.value)) {
    return {
      severity: 'CRITICAL',
      ruleId: RULE_ID,
      location: `תרגיל ${exercise.index} / בלוק ${blockPosition}`,
      title: 'correctOptionIds מסמן תשובה שאינה תואמת ל-solution',
      evidence: `option="${correctOption.text}" | solution="${block.solution.value}" | normalized: "${normalizeAnswer(correctOption.text)}" vs "${normalizeAnswer(block.solution.value)}"`,
      explanation:
        'האופציה המסומנת כנכונה ב-correctOptionIds אינה שווה (אחרי נורמליזציה) לערך שב-solution. בפרקטיקה זה אומר שהתלמיד יסומן כטועה גם כשענה נכון (או ההפך).',
    }
  }

  return null
}

export function runMcqCorrectOption(lesson: LessonModel): Finding[] {
  const findings: Finding[] = []
  for (const exercise of lesson.exercises) {
    exercise.blocks.forEach((block, i) => {
      if (block.kind !== 'mcq') return
      const finding = checkBlock(lesson, exercise, block, i + 1)
      if (finding) findings.push(finding)
    })
  }
  return findings
}
