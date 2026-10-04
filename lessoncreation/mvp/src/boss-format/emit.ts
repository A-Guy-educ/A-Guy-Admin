/**
 * Convert our internal v2 format to boss's approved import format.
 *
 * Boss's format (from his lesson_prompt.txt + lesson_6 sample):
 *   - 80-char `====` separator around exercise header
 *   - `תרגיל N – <kind>: <name>` header (no square brackets)
 *   - Free-text intro directly under header (no `* טקסט:` prefix)
 *   - Geometry block right after intro (we currently emit our compact DSL;
 *     boss's YAML-nested spec is a future step)
 *   - 80-char `----` separator around section header
 *   - `[תרגיל N - סעיף א]` header (no gershayim, no "- <question type>" tail)
 *   - Fields in order: * תוכן השאלה: → * אופציות: (dashed) → * פתרון נכון: →
 *     * רמז: → * פתרון מלא:
 *   - No `* סוג השאלה:` — question type inferred from structure
 *
 * The `<kind>` label is a pedagogical stance (מנחה/בסיס/מורכב/אתגר). Since
 * our skeleton doesn't carry it explicitly, we default by exercise number:
 * 1-3 = מנחה (guided/intro), 4-6 = בסיס (baseline), 7-9 = מורכב (complex),
 * 10 = אתגר (challenge). This mirrors the shape boss's example lessons use.
 */
import { parseTextLessonV2 } from '../../../../src/server/services/text-lesson-import/parse-text-v2.js'
import type { LessonSkeleton } from '../planner/schema.js'

const EXERCISE_SEP = '='.repeat(80)
const SECTION_SEP = '-'.repeat(80)

function exerciseKind(number: number): string {
  if (number <= 3) return 'מנחה'
  if (number <= 6) return 'בסיס'
  if (number <= 9) return 'מורכב'
  return 'אתגר'
}

/**
 * Shorten a full-sentence objective into an exercise-title phrase.
 * Cuts at first strong break (period, comma, "אנחנו/נבחין/נלמד" clause) and
 * caps to ~60 chars. Boss's example uses things like
 * "היכרות אינטואיטיבית – מודל המעלית" — a single tight phrase.
 */
function shortenObjective(objective: string, maxLen = 60): string {
  const firstPhrase = objective.split(/[.,\n]/)[0].trim()
  if (firstPhrase.length <= maxLen) return firstPhrase
  // Trim at last space within the cap so we don't cut a word.
  const cut = firstPhrase.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…'
}

/**
 * Extract the raw geometry block text from `* שרטוט בסיס:` up to the next
 * exercise-or-section separator/header. Preserves the model's original DSL
 * formatting rather than re-serializing from the parsed spec.
 *
 * Returns the geometry lines with the `* שרטוט בסיס:` marker stripped, or
 * null when the exercise has no base drawing.
 */
function extractRawGeometryBlock(exerciseBlock: string): string | null {
  const lines = exerciseBlock.split('\n')
  let inGeom = false
  const collected: string[] = []
  for (const line of lines) {
    if (/^\s*\*\s*שרטוט\s+בסיס\s*:/.test(line)) {
      inGeom = true
      continue
    }
    if (!inGeom) continue
    // Stop at a new field or at a separator line — geometry is indented under
    // its parent field, so a top-level `*` field or `====` fence ends it.
    if (/^\*\s+[^\s]/.test(line)) break
    if (/^=+$/.test(line.trim())) break
    if (/^\[\s*(סעיף|תרגיל)/.test(line.trim())) break
    collected.push(line)
  }
  const trimmed = collected.join('\n').replace(/^\n+|\n+$/g, '')
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Extract the raw text of exercise N from a full v2 lesson, from its opening
 * fence through just before the next exercise header. Used to pull the raw
 * geometry block out of each exercise.
 */
function extractExerciseRawBlock(fullText: string, exerciseNumber: string): string | null {
  const startRe = new RegExp(
    `\\[\\s*תרגיל\\s+${exerciseNumber}\\s*[-–]\\s*נתוני\\s*פתיחה\\s*\\]`,
  )
  const startMatch = startRe.exec(fullText)
  if (!startMatch) return null
  // Find the next exercise's header (any number).
  const anyRe = /\[\s*תרגיל\s+\S+\s*[-–]\s*נתוני\s*פתיחה\s*\]/g
  anyRe.lastIndex = startMatch.index + startMatch[0].length
  const nextMatch = anyRe.exec(fullText)
  const endIdx = nextMatch ? nextMatch.index : fullText.length
  return fullText.slice(startMatch.index, endIdx)
}

export function emitBossFormat(v2Text: string, skeleton: LessonSkeleton): string {
  const parsed = parseTextLessonV2(v2Text)
  const out: string[] = []

  for (const parsedEx of parsed.exercises) {
    const num = Number(parsedEx.exerciseNumber)
    if (!Number.isFinite(num)) continue
    const skeletonEx = skeleton.exercises.find((e) => e.number === num)
    const kind = exerciseKind(num)
    const name = skeletonEx ? shortenObjective(skeletonEx.objective) : `תרגיל ${num}`

    out.push(EXERCISE_SEP)
    out.push(`תרגיל ${num} – ${kind}: ${name}`)
    out.push(EXERCISE_SEP)

    if (parsedEx.intro) out.push(parsedEx.intro.trim())

    // Base geometry — extract raw block to preserve formatting rather than
    // re-serializing from the parsed spec.
    const exerciseBlock = extractExerciseRawBlock(v2Text, parsedEx.exerciseNumber)
    if (exerciseBlock) {
      const rawGeom = extractRawGeometryBlock(exerciseBlock)
      if (rawGeom) {
        out.push('')
        out.push(rawGeom)
      }
    }
    if (parsedEx.sharedSvg) {
      out.push('')
      out.push(parsedEx.sharedSvg.trim())
    }

    for (const sec of parsedEx.sections) {
      out.push('')
      out.push(SECTION_SEP)
      out.push(`[תרגיל ${num} - סעיף ${sec.questionNumber.replace(/['′]$/, '')}]`)
      out.push(SECTION_SEP)

      out.push(`* תוכן השאלה: ${sec.question.trim()}`)

      if (sec.type.kind === 'mcq') {
        out.push(`* אופציות:`)
        for (const opt of sec.options) {
          out.push(`  - ${opt.text.trim()}`)
        }
        const correct = sec.options.find((o) => o.correct)
        if (correct) out.push(`* פתרון נכון: ${correct.text.trim()}`)
      } else if (sec.type.kind === 'free_response') {
        // Boss's format: for open-ended, פתרון נכון is a canonical answer or
        // grading rule. Our internal format doesn't have a separate answer
        // field for open-ended — the first line of fullSolution is the best
        // proxy.
        if (sec.fullSolution) {
          const firstLine = sec.fullSolution.trim().split(/\r?\n/)[0].trim()
          out.push(`* פתרון נכון: ${firstLine}`)
        }
      }

      if (sec.hint) out.push(`* רמז: ${sec.hint.trim()}`)
      if (sec.fullSolution) {
        // Multi-line solutions: keep as-is; boss's format allows continuation
        // on subsequent lines after the field marker.
        out.push(`* פתרון מלא: ${sec.fullSolution.trim()}`)
      }
    }

    out.push('')
  }

  return out.join('\n').trimEnd() + '\n'
}
