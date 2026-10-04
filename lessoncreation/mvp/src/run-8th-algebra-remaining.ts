/**
 * Fire the 2 word-problems lessons that failed on the earlier retry due to
 * transient Gemini 503s. Now runs with the withHttpRetry wrapper baked into
 * every Gemini call site (writer, critic, reader-critic, materializer,
 * convert-and-plan), so transient overloads recover automatically with 5-405s
 * exponential backoff.
 *
 * Concurrency 1 for maximum overnight-friendliness — the retry logic
 * handles rate limits, but we don't want to compete with ourselves for
 * a scarce resource.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const COURSE = 'כיתה ח'

const LESSONS: GenerationInput[] = [
  {
    course: COURSE,
    chapter: 'אלגברה — בעיות מילוליות',
    lessonName: 'בעיות מילוליות — כלליות',
    prevLesson: 'מערכת משוואות — השוואת מקדמים',
    nextLesson: 'בעיות מילוליות — העברה',
    gradeLevel: '8',
    notes: 'תרגום בעיות מילוליות למשוואות. זיהוי הנעלם, בניית ביטוי אלגברי, פתרון ובדיקת סבירות.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — בעיות מילוליות',
    lessonName: 'בעיות מילוליות — קנייה ומכירה',
    prevLesson: 'בעיות מילוליות — העברה',
    nextLesson: 'פונקציה קווית — מבוא',
    gradeLevel: '8',
    notes: 'בעיות עסקיות: מחיר יחידה × כמות = מחיר כולל. הנחות, מבצעים, השוואות של אפשרויות רכישה.',
  },
]

interface LessonOutcome {
  lessonName: string
  ok: boolean
  err?: string
  outcome?: string
  blockingBefore?: number
  blockingAfter?: number
  chars?: number
  durationMs: number
}

async function runOne(input: GenerationInput): Promise<LessonOutcome> {
  const t0 = Date.now()
  console.log(`[start] ${input.lessonName}`)
  try {
    const result = await runPipeline(input)
    const firstReader = result.readerCriticIterations?.[0]?.result
    const lastReader =
      result.readerCriticIterations?.[result.readerCriticIterations.length - 1]?.result
    const bBefore = firstReader ? firstReader.totalCritical + firstReader.totalHigh : undefined
    const bAfter = lastReader ? lastReader.totalCritical + lastReader.totalHigh : undefined
    const ms = Date.now() - t0
    console.log(
      `[done] ${input.lessonName} — ${(ms / 1000).toFixed(0)}s | ${result.outcome} | blocking: ${bBefore ?? '?'} → ${bAfter ?? '?'}`,
    )
    return {
      lessonName: input.lessonName,
      ok: true,
      outcome: result.outcome,
      blockingBefore: bBefore,
      blockingAfter: bAfter,
      chars: result.lessonText?.length,
      durationMs: ms,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[fail] ${input.lessonName} — ${msg.slice(0, 300)}`)
    return {
      lessonName: input.lessonName,
      ok: false,
      err: msg,
      durationMs: Date.now() - t0,
    }
  }
}

async function main() {
  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-lessons')
  mkdirSync(outDir, { recursive: true })

  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ 8TH GRADE REMAINING (retry-with-backoff): ${LESSONS.length} lessons, sequential`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()
  const outcomes: LessonOutcome[] = []
  for (const input of LESSONS) {
    outcomes.push(await runOne(input))
  }

  const lines: string[] = []
  lines.push(`# 8th Grade Remaining — retry with backoff`)
  lines.push('')
  lines.push(`- **Total wall time**: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`)
  lines.push('')
  lines.push(`| Lesson | Status | Outcome | Blocking (before → after) | Time |`)
  lines.push(`|---|---|---|---|---|`)
  for (const o of outcomes) {
    if (o.ok) {
      lines.push(
        `| ${o.lessonName} | ✅ | ${o.outcome} | ${o.blockingBefore ?? '?'} → ${o.blockingAfter ?? '?'} | ${(o.durationMs / 1000).toFixed(0)}s |`,
      )
    } else {
      lines.push(`| ${o.lessonName} | ❌ | — | — | ${(o.durationMs / 1000).toFixed(0)}s |`)
    }
  }
  writeFileSync(resolve(outDir, 'batch-8th-algebra-remaining.md'), lines.join('\n'), 'utf8')

  const ok = outcomes.filter((o) => o.ok).length
  console.log('')
  console.log(`══════ REMAINING DONE ══════`)
  console.log(`Succeeded: ${ok}/${LESSONS.length}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
