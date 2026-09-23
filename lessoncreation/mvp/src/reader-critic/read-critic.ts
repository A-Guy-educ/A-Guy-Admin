/**
 * Reader critic stage — the sixth pipeline stage.
 *
 * Takes the full v2 lesson text (post-materializer) and the skeleton it was
 * built from. For each exercise, extracts the rendered block and runs a
 * per-exercise Gemini call that acts as a student reading the exercise.
 * Returns per-exercise verdicts (may include CRITICAL/HIGH findings).
 *
 * Runs the 10 per-exercise calls with concurrency 4 (same pattern as the
 * materializer). Fully parallel-friendly since each call is independent.
 */
import { generateJson } from '../gemini-client.js'
import type { LessonSkeleton } from '../planner/schema.js'
import { buildReaderCriticSystemPrompt, buildReaderCriticUserPrompt } from './prompt.js'
import { ReaderExerciseVerdict, type ReaderExerciseVerdict as VerdictType } from './schema.js'

import { MODEL_READER_CRITIC } from '../models.js'

const DEFAULT_MODEL = MODEL_READER_CRITIC
const CONCURRENCY = 4

export interface ReaderCriticResult {
  verdicts: VerdictType[]
  /** exercises that need patching — CRITICAL or HIGH findings present. */
  flaggedExerciseNumbers: number[]
  totalCritical: number
  totalHigh: number
  totalMedium: number
  totalLow: number
}

/**
 * Extract the raw text of exercise N from the full v2 lesson text.
 * Boundaries: from `[ תרגיל N - נתוני פתיחה ]` header to just before the
 * NEXT exercise header (any number greater than N — the patch text may
 * skip numbers when only some exercises were regenerated, so we can't
 * hard-code N+1).
 */
export function extractExerciseText(fullText: string, exerciseNumber: number): string | null {
  const startRe = new RegExp(
    `\\[\\s*תרגיל\\s+${exerciseNumber}\\s*[-–]\\s*נתוני\\s+פתיחה\\s*\\]`,
  )
  const startMatch = startRe.exec(fullText)
  if (!startMatch) return null
  // Include the "===" fence line above the header if present.
  const startIdx = fullText.lastIndexOf('=================', startMatch.index)
  const from = startIdx >= 0 ? startIdx : startMatch.index

  // Find the next exercise header at any number after our start position.
  // Using a global regex over the tail so a gap in numbering (e.g., patch
  // text with [1, 3, 4, 5]) is handled correctly — we stop at whichever
  // exercise header comes next, not specifically N+1.
  const anyExerciseRe = /\[\s*תרגיל\s+(\d+)\s*[-–]\s*נתוני\s+פתיחה\s*\]/g
  anyExerciseRe.lastIndex = startMatch.index + startMatch[0].length
  const nextMatch = anyExerciseRe.exec(fullText)
  const endIdx = nextMatch
    ? Math.max(fullText.lastIndexOf('=================', nextMatch.index), nextMatch.index)
    : fullText.length
  return fullText.slice(from, endIdx).trim()
}

async function critiqueOne(
  skeletonExercise: LessonSkeleton['exercises'][number],
  renderedText: string,
): Promise<VerdictType> {
  const verdict = await generateJson({
    systemInstruction: buildReaderCriticSystemPrompt(),
    userPrompt: buildReaderCriticUserPrompt(skeletonExercise, renderedText),
    schema: ReaderExerciseVerdict,
    modelName: DEFAULT_MODEL,
    temperature: 0.1,
    maxOutputTokens: 4096,
  })
  // Consistency: `passed` should be true iff no CRITICAL/HIGH.
  const hasBlocking = verdict.findings.some(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
  )
  return { ...verdict, passed: !hasBlocking }
}

export async function readCritic(
  fullText: string,
  skeleton: LessonSkeleton,
): Promise<ReaderCriticResult> {
  const verdicts: VerdictType[] = new Array(skeleton.exercises.length)

  // Build the work items — each is a skeleton exercise + its rendered text.
  const items: Array<{ ex: LessonSkeleton['exercises'][number]; text: string; slot: number }> = []
  for (let i = 0; i < skeleton.exercises.length; i++) {
    const ex = skeleton.exercises[i]
    const renderedText = extractExerciseText(fullText, ex.number)
    if (!renderedText) {
      verdicts[i] = {
        exerciseNumber: ex.number,
        passed: false,
        summary: `Exercise ${ex.number} not found in the rendered text — writer may have skipped or truncated.`,
        findings: [
          {
            severity: 'CRITICAL',
            sectionLetter: 'exercise',
            kind: 'other',
            issue: `תרגיל ${ex.number} לא נמצא בטקסט המרונדר`,
            suggestedFix: `הפעל שוב את ה-writer עבור תרגיל ${ex.number}`,
          },
        ],
      }
      continue
    }
    items.push({ ex, text: renderedText, slot: i })
  }

  // Concurrency-limited parallel critique.
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(chunk.map((it) => critiqueOne(it.ex, it.text)))
    settled.forEach((res, k) => {
      const item = chunk[k]
      if (res.status === 'fulfilled') {
        verdicts[item.slot] = res.value
      } else {
        const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
        verdicts[item.slot] = {
          exerciseNumber: item.ex.number,
          passed: false,
          summary: `Reader critic call failed for exercise ${item.ex.number}: ${msg}`,
          findings: [
            {
              severity: 'MEDIUM',
              sectionLetter: 'exercise',
              kind: 'other',
              issue: `שגיאה בקריאה של תרגיל ${item.ex.number}: ${msg}`,
              suggestedFix: 'הפעל שוב את ה-reader critic',
            },
          ],
        }
      }
    })
  }

  const flaggedExerciseNumbers: number[] = []
  let critical = 0
  let high = 0
  let medium = 0
  let low = 0
  for (const v of verdicts) {
    if (!v) continue
    const hasBlocking = v.findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
    if (hasBlocking) flaggedExerciseNumbers.push(v.exerciseNumber)
    for (const f of v.findings) {
      if (f.severity === 'CRITICAL') critical++
      else if (f.severity === 'HIGH') high++
      else if (f.severity === 'MEDIUM') medium++
      else low++
    }
  }

  return {
    verdicts,
    flaggedExerciseNumbers,
    totalCritical: critical,
    totalHigh: high,
    totalMedium: medium,
    totalLow: low,
  }
}
