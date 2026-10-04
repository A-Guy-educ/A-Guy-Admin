/**
 * Corpus sample runner — trimmed validation pipeline for the boss's
 * existing lessons.
 *
 * For each sample lesson:
 *   1. Read the format-B .txt from disk.
 *   2. Convert to format A + reverse-plan a skeleton (single Gemini call).
 *   3. Run the reader critic per exercise (Gemini calls, concurrency 4).
 *   4. Persist artifacts:
 *      - lessoncreation/mvp/corpus-samples/<stem>.formatA.txt
 *      - lessoncreation/mvp/corpus-samples/<stem>.skeleton.json
 *      - lessoncreation/mvp/corpus-samples/<stem>.reader-verdict.json
 *      - lessoncreation/mvp/corpus-samples/<stem>.report.md  (human-readable)
 *
 * Two samples are hardcoded here — one pure-algebra, one geometry-in-prose
 * — to see how the trimmed pipeline behaves across content types.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { convertAndPlan } from './corpus-import/convert-and-plan.js'
import { readCritic, type ReaderCriticResult } from './reader-critic/read-critic.js'

interface Sample {
  path: string
  lessonName: string
  course: string
  chapter: string
}

const SAMPLES: Sample[] = [
  {
    path: 'C:/Users/kotz9/OneDrive/Desktop/gene/שעורי לימוד - חטיבה-20260922T062015Z-1-001/שעורי לימוד - חטיבה/כיתה י - שעורי לימוד/כיתה_י_-_שיעור_1_-_משוואות.txt',
    lessonName: 'משוואות',
    course: 'כיתה י',
    chapter: 'אלגברה',
  },
  {
    path: 'C:/Users/kotz9/OneDrive/Desktop/gene/שעורי לימוד - חטיבה-20260922T062015Z-1-001/שעורי לימוד - חטיבה/כיתה י - שעורי לימוד/כיתה_י_-_שיעור_45_-_משפט_תלס.txt',
    lessonName: 'משפט תלס',
    course: 'כיתה י',
    chapter: 'גיאומטריה',
  },
]

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

function renderReport(sample: Sample, reader: ReaderCriticResult): string {
  const lines: string[] = []
  lines.push(`# דוח קריאה — ${sample.lessonName}`)
  lines.push('')
  lines.push(`- **קורס**: ${sample.course}`)
  lines.push(`- **פרק**: ${sample.chapter}`)
  lines.push(`- **קובץ מקור**: \`${basename(sample.path)}\``)
  lines.push('')
  lines.push(`## סיכום`)
  lines.push('')
  lines.push(`| חומרה | כמות |`)
  lines.push(`|---|---|`)
  lines.push(`| CRITICAL | ${reader.totalCritical} |`)
  lines.push(`| HIGH | ${reader.totalHigh} |`)
  lines.push(`| MEDIUM | ${reader.totalMedium} |`)
  lines.push(`| LOW | ${reader.totalLow} |`)
  lines.push('')
  lines.push(`**תרגילים דגולים לתיקון**: ${reader.flaggedExerciseNumbers.join(', ') || '(אין)'}`)
  lines.push('')
  lines.push(`## פירוט לפי תרגיל`)
  lines.push('')
  for (const v of reader.verdicts) {
    if (!v) continue
    const badge = v.passed ? '✅' : v.findings.some((f) => f.severity === 'CRITICAL') ? '🔴' : '🟡'
    lines.push(`### ${badge} תרגיל ${v.exerciseNumber}`)
    if (v.summary) {
      lines.push('')
      lines.push(v.summary)
    }
    if (v.findings.length > 0) {
      lines.push('')
      for (const f of v.findings) {
        const loc = f.sectionLetter === 'exercise' ? 'כלל-תרגילי' : `סעיף ${f.sectionLetter}'`
        lines.push(`- **[${f.severity} — ${loc}, ${f.kind}]** ${f.issue}`)
        lines.push(`  - **הצעת תיקון**: ${f.suggestedFix}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function processSample(sample: Sample, outDir: string): Promise<void> {
  const stem = safeName(sample.lessonName)
  const t0 = Date.now()

  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ CORPUS SAMPLE: ${sample.lessonName}`)
  console.log(`╚═══════════════════════════════════════════════`)

  console.log(`━━━ [Read] ${basename(sample.path)} ━━━`)
  const formatBText = readFileSync(sample.path, 'utf8')
  console.log(`  → ${formatBText.length} chars, ${formatBText.split(/\r?\n/).length} lines`)

  console.log(`━━━ [Convert + Reverse-plan] ${sample.lessonName} ━━━`)
  const converted = await convertAndPlan({
    lessonName: sample.lessonName,
    course: sample.course,
    chapter: sample.chapter,
    formatBText,
  })
  console.log(
    `  → v2 output: ${converted.v2Text.length} chars | skeleton: ${converted.skeleton.exercises.length} exercises`,
  )
  writeFileSync(resolve(outDir, `${stem}.formatA.txt`), converted.v2Text, 'utf8')
  writeFileSync(
    resolve(outDir, `${stem}.skeleton.json`),
    JSON.stringify(converted.skeleton, null, 2),
    'utf8',
  )

  console.log(`━━━ [Reader Critic] ${sample.lessonName} ━━━`)
  const reader = await readCritic(converted.v2Text, converted.skeleton)
  console.log(
    `  → CRIT:${reader.totalCritical} HIGH:${reader.totalHigh} MED:${reader.totalMedium} LOW:${reader.totalLow} | flagged: [${reader.flaggedExerciseNumbers.join(', ') || '-'}]`,
  )
  writeFileSync(
    resolve(outDir, `${stem}.reader-verdict.json`),
    JSON.stringify(reader, null, 2),
    'utf8',
  )
  writeFileSync(resolve(outDir, `${stem}.report.md`), renderReport(sample, reader), 'utf8')

  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log('')
  console.log(`══════ SUMMARY: ${sample.lessonName} ══════`)
  console.log(`Time: ${secs}s`)
  console.log(`CRIT:${reader.totalCritical} HIGH:${reader.totalHigh} MED:${reader.totalMedium} LOW:${reader.totalLow}`)
  console.log(`Flagged: [${reader.flaggedExerciseNumbers.join(', ') || 'none'}]`)
  console.log(`Report: ${resolve(outDir, `${stem}.report.md`)}`)
}

async function main() {
  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'corpus-samples')
  mkdirSync(outDir, { recursive: true })
  console.log('')
  console.log(`Corpus samples output: ${outDir}`)

  // Run samples sequentially so the log stream stays coherent (each is
  // internally parallel via readCritic's concurrency=4).
  for (const sample of SAMPLES) {
    try {
      await processSample(sample, outDir)
    } catch (err) {
      console.error('')
      console.error(`❌ Failed on ${sample.lessonName}: ${err instanceof Error ? err.message : err}`)
      if (err instanceof Error && err.stack) console.error(err.stack)
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
