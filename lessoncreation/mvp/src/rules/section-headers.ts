/**
 * CRITICAL rule: every question block (MCQ / free-response) must carry a
 * section header — `**סעיף X:**` — in its prompt so the student can tell
 * which sub-question they're on.
 *
 * Auditor findings that motivated this: "תרגיל 7 / בלוק 3 — סעיף ללא
 * כותרת" and "תרגיל 8 / בלוק 2 — סעיף א ללא כותרת". When these headers
 * are missing, the UI shows the prompt with no navigation cue and the
 * learner can't tell what sub-section they're solving.
 *
 * Only fires when the exercise has 2+ question blocks — a single-question
 * exercise doesn't need sub-labels.
 */
import type { Finding, LessonModel } from '../types.js'

const RULE_ID = 'section-headers'

// Matches `**סעיף א:**`, `**סעיף א**:`, `סעיף א:`, or `**סעיף 1:**`.
// Learning lessons label sections with Hebrew letters (א/ב/ג/ד/ה/ו);
// practice lessons use numeric labels (1-9). Both are valid — reject
// only when NO recognized label is present.
const SECTION_HEADER_RE = /(?:\*\*)?\s*סעיף\s+([אבגדהו]|\d+)\s*(?:\*\*)?\s*[:：]/

export function runSectionHeaders(lesson: LessonModel): Finding[] {
  const findings: Finding[] = []

  for (const exercise of lesson.exercises) {
    const questionBlocks = exercise.blocks
      .map((block, i) => ({ block, position: i + 1 }))
      .filter((x) => x.block.kind === 'mcq' || x.block.kind === 'free_response')

    // Single question — no header expected.
    if (questionBlocks.length < 2) continue

    for (const { block, position } of questionBlocks) {
      const prompt = block.kind === 'mcq' ? block.prompt.value : block.prompt.value
      if (SECTION_HEADER_RE.test(prompt)) continue

      findings.push({
        severity: 'CRITICAL',
        ruleId: RULE_ID,
        location: `תרגיל ${exercise.index} / בלוק ${position}`,
        title: 'שאלה ללא כותרת "סעיף X"',
        evidence: `prompt="${prompt.slice(0, 120).replace(/\n/g, ' ')}"`,
        explanation:
          'בבלוק שאלה זה חסרה כותרת בפורמט **סעיף X:**. התלמיד לא רואה סימון של איזה סעיף הוא פותר. יש להוסיף כותרת בתחילת ה-prompt.',
      })
    }
  }

  return findings
}
