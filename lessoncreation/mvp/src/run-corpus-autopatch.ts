/**
 * Auto-patch runner for a corpus-imported lesson.
 *
 * Reads the artifacts produced by run-corpus-sample.ts:
 *   - <stem>.formatA.txt         (converted v2 text)
 *   - <stem>.skeleton.json       (reverse-planned skeleton)
 *   - <stem>.reader-verdict.json (reader critic iter 1)
 *
 * For each exercise flagged by the reader critic (CRITICAL or HIGH), the
 * writer regenerates using the same three-input contract we use inside the
 * main pipeline's reader-critic fix loop:
 *   - onlyExercises           = flagged numbers, chunked (max 3 per call)
 *   - feedbackPerExercise     = CRITICAL/HIGH findings per exercise
 *   - previousTextPerExercise = the exercise's current rendered text
 *
 * The chunked patches are spliced back in, then reader critic runs a
 * second pass to measure the lift.
 *
 * Outputs:
 *   - <stem>.patched.txt          — the lesson after auto-patch
 *   - <stem>.reader-iter2.json    — verdict after patching
 *   - <stem>.autopatch-report.md  — before/after summary + per-exercise diff
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  extractExerciseText,
  readCritic,
  type ReaderCriticResult,
} from './reader-critic/read-critic.js'
import { spliceExercises } from './reader-critic/splice.js'
import type { LessonSkeleton } from './planner/schema.js'
import { writeLesson } from './writer/write-lesson.js'

const TARGET_STEM = process.env.CORPUS_TARGET ?? 'משוואות'

const MAX_PATCH_CHUNK = 3

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

function buildFeedbackForExercise(verdict: {
  exerciseNumber: number
  findings: Array<{
    severity: string
    sectionLetter: string
    kind: string
    issue: string
    suggestedFix: string
  }>
}): string | null {
  const blocking = verdict.findings.filter(
    (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
  )
  if (blocking.length === 0) return null
  const lines: string[] = []
  for (const f of blocking) {
    const loc = f.sectionLetter === 'exercise' ? 'כלל-תרגילי' : `סעיף ${f.sectionLetter}'`
    lines.push(`- [${f.severity} — ${loc}, ${f.kind}] ${f.issue} → ${f.suggestedFix}`)
  }
  return lines.join('\n')
}

function renderAutopatchReport(
  stem: string,
  before: ReaderCriticResult,
  after: ReaderCriticResult,
  patchedExercises: number[],
  spliceFailed: boolean,
): string {
  const lines: string[] = []
  lines.push(`# דוח תיקון אוטומטי — ${stem}`)
  lines.push('')
  lines.push(`## סיכום ההשוואה`)
  lines.push('')
  lines.push(`| חומרה | לפני | אחרי | שינוי |`)
  lines.push(`|---|---|---|---|`)
  lines.push(
    `| CRITICAL | ${before.totalCritical} | ${after.totalCritical} | ${diff(before.totalCritical, after.totalCritical)} |`,
  )
  lines.push(
    `| HIGH | ${before.totalHigh} | ${after.totalHigh} | ${diff(before.totalHigh, after.totalHigh)} |`,
  )
  lines.push(
    `| MEDIUM | ${before.totalMedium} | ${after.totalMedium} | ${diff(before.totalMedium, after.totalMedium)} |`,
  )
  lines.push(
    `| LOW | ${before.totalLow} | ${after.totalLow} | ${diff(before.totalLow, after.totalLow)} |`,
  )
  lines.push('')
  lines.push(`**תרגילים שתוקנו**: ${patchedExercises.join(', ') || '(אין)'}`)
  if (spliceFailed) lines.push(`\n> ⚠ splice נכשל באחד ה-chunks — ראה יומן.`)
  lines.push('')
  lines.push(`## תרגילים דגולים אחרי:`)
  lines.push(`[${after.flaggedExerciseNumbers.join(', ') || '-'}]`)
  lines.push('')
  lines.push(`## פירוט לפי תרגיל — לפני / אחרי`)
  lines.push('')
  const beforeMap = new Map(before.verdicts.map((v) => [v.exerciseNumber, v]))
  const afterMap = new Map(after.verdicts.map((v) => [v.exerciseNumber, v]))
  const numbers = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((a, b) => a - b)
  for (const n of numbers) {
    const b = beforeMap.get(n)
    const a = afterMap.get(n)
    if (!b || !a) continue
    const bBlock = b.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length
    const aBlock = a.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length
    const badge = aBlock === 0 && bBlock > 0 ? '✅ תוקן' : aBlock === bBlock ? '➖' : aBlock > bBlock ? '🔴 נסוג' : '🟡 שופר'
    lines.push(`### תרגיל ${n} — ${badge}`)
    lines.push(`- **לפני**: ${b.findings.length} ממצאים (${bBlock} חוסמים)`)
    lines.push(`- **אחרי**: ${a.findings.length} ממצאים (${aBlock} חוסמים)`)
    if (a.findings.length > 0) {
      lines.push(`- **ממצאים שנותרו**:`)
      for (const f of a.findings) {
        const loc = f.sectionLetter === 'exercise' ? 'כלל-תרגילי' : `סעיף ${f.sectionLetter}'`
        lines.push(`  - [${f.severity} — ${loc}] ${f.issue}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

function diff(before: number, after: number): string {
  const d = after - before
  if (d === 0) return '0'
  if (d < 0) return `−${-d}` // Improvement
  return `+${d}` // Regression
}

async function main() {
  const baseDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'corpus-samples')
  mkdirSync(baseDir, { recursive: true })

  const stem = safeName(TARGET_STEM)
  const formatAPath = resolve(baseDir, `${stem}.formatA.txt`)
  const skeletonPath = resolve(baseDir, `${stem}.skeleton.json`)
  const verdictPath = resolve(baseDir, `${stem}.reader-verdict.json`)

  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ AUTO-PATCH: ${TARGET_STEM}`)
  console.log(`╚═══════════════════════════════════════════════`)

  const lessonText = readFileSync(formatAPath, 'utf8')
  const skeleton = JSON.parse(readFileSync(skeletonPath, 'utf8')) as LessonSkeleton
  const before = JSON.parse(readFileSync(verdictPath, 'utf8')) as ReaderCriticResult

  console.log(
    `━━━ [Load] ${lessonText.length} chars, ${skeleton.exercises.length} exercises, ${before.flaggedExerciseNumbers.length} flagged ━━━`,
  )
  console.log(
    `  Before: CRIT:${before.totalCritical} HIGH:${before.totalHigh} MED:${before.totalMedium} LOW:${before.totalLow}`,
  )
  console.log(`  Flagged: [${before.flaggedExerciseNumbers.join(', ')}]`)

  const flagged = before.flaggedExerciseNumbers
  if (flagged.length === 0) {
    console.log('nothing to patch — lesson is clean.')
    return
  }

  // Build feedback map from CRITICAL/HIGH findings.
  const feedbackPerExercise = new Map<number, string>()
  for (const v of before.verdicts) {
    if (!flagged.includes(v.exerciseNumber)) continue
    const fb = buildFeedbackForExercise(v)
    if (fb) feedbackPerExercise.set(v.exerciseNumber, fb)
  }

  // Chunk flagged into groups of MAX_PATCH_CHUNK — writer regen with per-
  // exercise feedback + previous text gets brittle beyond ~3 at a time.
  const chunks: number[][] = []
  for (let i = 0; i < flagged.length; i += MAX_PATCH_CHUNK) {
    chunks.push(flagged.slice(i, i + MAX_PATCH_CHUNK))
  }

  console.log(
    `━━━ [Writer regen] patching [${flagged.join(', ')}] in ${chunks.length} parallel call${chunks.length > 1 ? 's' : ''} ━━━`,
  )

  const patchResults = await Promise.all(
    chunks.map((chunk) => {
      const chunkFeedback = new Map<number, string>()
      const chunkPrevious = new Map<number, string>()
      for (const n of chunk) {
        const fb = feedbackPerExercise.get(n)
        if (fb) chunkFeedback.set(n, fb)
        const prev = extractExerciseText(lessonText, n)
        if (prev) chunkPrevious.set(n, prev)
      }
      return writeLesson(skeleton, {
        onlyExercises: chunk,
        feedbackPerExercise: chunkFeedback,
        previousTextPerExercise: chunkPrevious,
      })
    }),
  )

  // Splice each chunk into the lesson text.
  let patchedText = lessonText
  let spliceFailed = false
  const successfullyPatched: number[] = []
  for (let i = 0; i < chunks.length; i++) {
    try {
      patchedText = spliceExercises(patchedText, patchResults[i].text, chunks[i])
      successfullyPatched.push(...chunks[i])
    } catch (err) {
      console.error(
        `  splice failed for chunk [${chunks[i].join(',')}]: ${err instanceof Error ? err.message : err}`,
      )
      spliceFailed = true
    }
  }

  writeFileSync(resolve(baseDir, `${stem}.patched.txt`), patchedText, 'utf8')

  console.log(`━━━ [Reader Critic iter 2] ${TARGET_STEM} ━━━`)
  const after = await readCritic(patchedText, skeleton)
  console.log(
    `  After: CRIT:${after.totalCritical} HIGH:${after.totalHigh} MED:${after.totalMedium} LOW:${after.totalLow}`,
  )
  console.log(`  Still flagged: [${after.flaggedExerciseNumbers.join(', ') || '-'}]`)
  writeFileSync(resolve(baseDir, `${stem}.reader-iter2.json`), JSON.stringify(after, null, 2), 'utf8')

  const report = renderAutopatchReport(TARGET_STEM, before, after, successfullyPatched, spliceFailed)
  writeFileSync(resolve(baseDir, `${stem}.autopatch-report.md`), report, 'utf8')

  console.log('')
  console.log(`══════ AUTO-PATCH SUMMARY: ${TARGET_STEM} ══════`)
  console.log(`Blocking (CRIT+HIGH): ${before.totalCritical + before.totalHigh} → ${after.totalCritical + after.totalHigh}`)
  console.log(`Flagged: ${before.flaggedExerciseNumbers.length} → ${after.flaggedExerciseNumbers.length}`)
  console.log(`Report: ${resolve(baseDir, `${stem}.autopatch-report.md`)}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
