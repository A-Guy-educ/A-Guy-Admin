/**
 * Batch runner: full trimmed pipeline on N corpus lessons in parallel.
 *
 * Per lesson:
 *   1. Read format-B .txt
 *   2. Convert to format A + reverse-plan skeleton (one Gemini call)
 *   3. Reader critic iter 1 on rendered v2 text
 *   4. If flagged: writer regen w/ feedback + previousText, splice back
 *   5. Reader critic iter 2 on patched text
 *   6. Persist artifacts + append to aggregate report
 *
 * All lessons run in parallel with a concurrency cap. Each lesson's stages
 * are sequential internally.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { convertAndPlan } from './corpus-import/convert-and-plan.js'
import {
  extractExerciseText,
  readCritic,
  type ReaderCriticResult,
} from './reader-critic/read-critic.js'
import { spliceExercises } from './reader-critic/splice.js'
import type { LessonSkeleton } from './planner/schema.js'
import { writeLesson } from './writer/write-lesson.js'

interface Sample {
  path: string
  lessonName: string
  course: string
  chapter: string
}

// Diverse sample: mix of algebra, geometry-in-prose, and function topics.
// Deliberately drawn from grade 10 so the material is comparable and boss's
// review effort is bounded.
const BASE = 'C:/Users/kotz9/OneDrive/Desktop/gene/שעורי לימוד - חטיבה-20260922T062015Z-1-001/שעורי לימוד - חטיבה/כיתה י - שעורי לימוד'

const SAMPLES: Sample[] = [
  {
    path: `${BASE}/כיתה_י_-_שיעור_2_-_משוואות_-_דו_ריבועיות.txt`,
    lessonName: 'משוואות דו-ריבועיות',
    course: 'כיתה י',
    chapter: 'אלגברה',
  },
  {
    path: `${BASE}/כיתה_י_-_שיעור_3_-_משוואות_-_עם_פרמטר.txt`,
    lessonName: 'משוואות עם פרמטר',
    course: 'כיתה י',
    chapter: 'אלגברה',
  },
  {
    path: `${BASE}/כיתה_י_-_שיעור_11_-_עלייה_וירידה_של_גרף.txt`,
    lessonName: 'עלייה וירידה של גרף',
    course: 'כיתה י',
    chapter: 'פונקציות',
  },
  {
    path: `${BASE}/כיתה_י_-_שיעור_17_-_פולינום_-_גזירה.txt`,
    lessonName: 'פולינום — גזירה',
    course: 'כיתה י',
    chapter: 'חדו״א',
  },
  {
    path: `${BASE}/כיתה_י_-_שיעור_43_-_מפגש_תיכונים_-_מבוא.txt`,
    lessonName: 'מפגש תיכונים — מבוא',
    course: 'כיתה י',
    chapter: 'גיאומטריה',
  },
  {
    path: `${BASE}/כיתה_י_-_שיעור_45_-_משפט_תלס.txt`,
    lessonName: 'משפט תלס (רה-רן)',
    course: 'כיתה י',
    chapter: 'גיאומטריה',
  },
]

const MAX_PATCH_CHUNK = 3
const LESSON_CONCURRENCY = 3

interface LessonOutcome {
  lessonName: string
  err?: string
  before?: { crit: number; high: number; med: number; low: number; flagged: number }
  after?: { crit: number; high: number; med: number; low: number; flagged: number }
  patched: number[]
  durationMs: number
}

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

function statsFrom(r: ReaderCriticResult) {
  return {
    crit: r.totalCritical,
    high: r.totalHigh,
    med: r.totalMedium,
    low: r.totalLow,
    flagged: r.flaggedExerciseNumbers.length,
  }
}

async function processLesson(sample: Sample, outDir: string): Promise<LessonOutcome> {
  const stem = safeName(sample.lessonName)
  const t0 = Date.now()
  try {
    console.log(`[start] ${sample.lessonName}`)

    const formatBText = readFileSync(sample.path, 'utf8')
    const converted = await convertAndPlan({
      lessonName: sample.lessonName,
      course: sample.course,
      chapter: sample.chapter,
      formatBText,
    })
    writeFileSync(resolve(outDir, `${stem}.formatA.txt`), converted.v2Text, 'utf8')
    writeFileSync(
      resolve(outDir, `${stem}.skeleton.json`),
      JSON.stringify(converted.skeleton, null, 2),
      'utf8',
    )

    const before = await readCritic(converted.v2Text, converted.skeleton)
    writeFileSync(
      resolve(outDir, `${stem}.reader-verdict.json`),
      JSON.stringify(before, null, 2),
      'utf8',
    )

    const flagged = before.flaggedExerciseNumbers
    let patchedText = converted.v2Text
    const patchedSuccessfully: number[] = []

    if (flagged.length > 0) {
      // Build feedback map.
      const feedbackPerExercise = new Map<number, string>()
      for (const v of before.verdicts) {
        if (!flagged.includes(v.exerciseNumber)) continue
        const blocking = v.findings.filter(
          (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
        )
        if (blocking.length === 0) continue
        const lines: string[] = []
        for (const f of blocking) {
          const loc = f.sectionLetter === 'exercise' ? 'כלל-תרגילי' : `סעיף ${f.sectionLetter}'`
          lines.push(`- [${f.severity} — ${loc}, ${f.kind}] ${f.issue} → ${f.suggestedFix}`)
        }
        feedbackPerExercise.set(v.exerciseNumber, lines.join('\n'))
      }

      // Chunk.
      const chunks: number[][] = []
      for (let i = 0; i < flagged.length; i += MAX_PATCH_CHUNK) {
        chunks.push(flagged.slice(i, i + MAX_PATCH_CHUNK))
      }

      const results = await Promise.all(
        chunks.map((chunk) => {
          const chunkFeedback = new Map<number, string>()
          const chunkPrevious = new Map<number, string>()
          for (const n of chunk) {
            const fb = feedbackPerExercise.get(n)
            if (fb) chunkFeedback.set(n, fb)
            const prev = extractExerciseText(patchedText, n)
            if (prev) chunkPrevious.set(n, prev)
          }
          return writeLesson(converted.skeleton, {
            onlyExercises: chunk,
            feedbackPerExercise: chunkFeedback,
            previousTextPerExercise: chunkPrevious,
          })
        }),
      )

      for (let i = 0; i < chunks.length; i++) {
        try {
          patchedText = spliceExercises(patchedText, results[i].text, chunks[i])
          patchedSuccessfully.push(...chunks[i])
        } catch (err) {
          console.error(
            `[${sample.lessonName}] splice failed for [${chunks[i].join(',')}]: ${err instanceof Error ? err.message : err}`,
          )
        }
      }
      writeFileSync(resolve(outDir, `${stem}.patched.txt`), patchedText, 'utf8')
    }

    const after = await readCritic(patchedText, converted.skeleton)
    writeFileSync(
      resolve(outDir, `${stem}.reader-iter2.json`),
      JSON.stringify(after, null, 2),
      'utf8',
    )

    const ms = Date.now() - t0
    console.log(
      `[done] ${sample.lessonName} — ${(ms / 1000).toFixed(0)}s | before CRIT:${before.totalCritical}/HIGH:${before.totalHigh} → after CRIT:${after.totalCritical}/HIGH:${after.totalHigh}`,
    )
    return {
      lessonName: sample.lessonName,
      before: statsFrom(before),
      after: statsFrom(after),
      patched: patchedSuccessfully,
      durationMs: ms,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[fail] ${sample.lessonName} — ${msg}`)
    return {
      lessonName: sample.lessonName,
      err: msg,
      patched: [],
      durationMs: Date.now() - t0,
    }
  }
}

async function main() {
  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'corpus-samples')
  mkdirSync(outDir, { recursive: true })

  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ CORPUS BATCH: ${SAMPLES.length} lessons, concurrency=${LESSON_CONCURRENCY}`)
  console.log(`╚═══════════════════════════════════════════════`)
  console.log('')

  const outcomes: LessonOutcome[] = []
  for (let i = 0; i < SAMPLES.length; i += LESSON_CONCURRENCY) {
    const batch = SAMPLES.slice(i, i + LESSON_CONCURRENCY)
    const results = await Promise.all(batch.map((s) => processLesson(s, outDir)))
    outcomes.push(...results)
  }

  // Aggregate report.
  const lines: string[] = []
  lines.push(`# Batch outcome — ${SAMPLES.length} lessons`)
  lines.push('')
  lines.push(`## Per-lesson summary`)
  lines.push('')
  lines.push(`| Lesson | Before (blocking) | After (blocking) | Δ | Patched | Time |`)
  lines.push(`|---|---|---|---|---|---|`)
  let sumBefore = 0
  let sumAfter = 0
  let cleanBefore = 0
  let cleanAfter = 0
  for (const o of outcomes) {
    if (o.err) {
      lines.push(`| ${o.lessonName} | ❌ ${o.err.slice(0, 60)} | — | — | — | ${(o.durationMs / 1000).toFixed(0)}s |`)
      continue
    }
    const b = o.before!
    const a = o.after!
    const bBlock = b.crit + b.high
    const aBlock = a.crit + a.high
    sumBefore += bBlock
    sumAfter += aBlock
    if (bBlock === 0) cleanBefore++
    if (aBlock === 0) cleanAfter++
    lines.push(
      `| ${o.lessonName} | CRIT:${b.crit} HIGH:${b.high} (${bBlock}) | CRIT:${a.crit} HIGH:${a.high} (${aBlock}) | ${aBlock - bBlock} | ${o.patched.length} | ${(o.durationMs / 1000).toFixed(0)}s |`,
    )
  }
  lines.push('')
  lines.push(`## Aggregate`)
  lines.push('')
  lines.push(`- **Blocking findings total**: ${sumBefore} → ${sumAfter} (${sumBefore > 0 ? Math.round(((sumBefore - sumAfter) / sumBefore) * 100) : 0}% reduction)`)
  const succeeded = outcomes.filter((o) => !o.err).length
  lines.push(`- **Lessons fully clean (0 blocking)**: ${cleanBefore} → ${cleanAfter} of ${succeeded}`)
  lines.push(`- **Lessons that failed**: ${outcomes.filter((o) => o.err).length}`)
  const totalTimeMs = outcomes.reduce((s, o) => s + o.durationMs, 0)
  lines.push(`- **Total wall time**: ${(totalTimeMs / 1000 / 60).toFixed(1)} min (concurrency=${LESSON_CONCURRENCY})`)

  const reportPath = resolve(outDir, 'batch-report.md')
  writeFileSync(reportPath, lines.join('\n'), 'utf8')
  console.log('')
  console.log(`══════ BATCH DONE ══════`)
  console.log(`Blocking findings: ${sumBefore} → ${sumAfter}`)
  console.log(`Fully clean: ${cleanBefore} → ${cleanAfter} of ${succeeded}`)
  console.log(`Report: ${reportPath}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
