/**
 * CRITICAL rule: an exercise must contain at least one question block
 * (MCQ or free_response). A lesson made entirely of rich_text intro
 * paragraphs is a scaffold, not a lesson — students have nothing to
 * practice.
 *
 * This is the most common CRITICAL the human auditor caught that our
 * other 3 rules missed (9 of 10 MISS lessons in regression matched this
 * pattern). Cheap to check, hard to false-positive.
 */
import type { Finding, LessonModel } from '../types.js'

const RULE_ID = 'exercise-has-questions'

export function runExerciseHasQuestions(lesson: LessonModel): Finding[] {
  const findings: Finding[] = []

  for (const exercise of lesson.exercises) {
    const hasQuestion = exercise.blocks.some(
      (b) => b.kind === 'mcq' || b.kind === 'free_response',
    )
    if (hasQuestion) continue

    // A "single rich_text intro" pattern is the pure-shell signature — flag
    // it. If the exercise has 0 blocks entirely, that's also a shell.
    findings.push({
      severity: 'CRITICAL',
      ruleId: RULE_ID,
      location: `תרגיל ${exercise.index}`,
      title: 'תרגיל ללא שאלות תרגול',
      evidence: `blocks=${exercise.blocks.length} kinds=[${exercise.blocks.map((b) => b.kind).join(', ')}]`,
      explanation:
        'תרגיל זה מכיל רק בלוקי מבוא (rich_text/svg) ואף שאלה. תלמיד קורא הסבר אך אינו מתאמן. יש להוסיף לפחות בלוק שאלה אחד (MCQ או שאלה פתוחה).',
    })
  }

  return findings
}
