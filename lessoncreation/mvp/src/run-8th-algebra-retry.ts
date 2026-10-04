/**
 * Retry the 3 word-problems lessons that hit Gemini 503 rate-limit errors
 * during the main 8th-grade algebra batch. Lower concurrency to give the
 * model breathing room.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const CONCURRENCY = 2
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
    lessonName: 'בעיות מילוליות — העברה',
    prevLesson: 'בעיות מילוליות — כלליות',
    nextLesson: 'בעיות מילוליות — קנייה ומכירה',
    gradeLevel: '8',
    notes: 'בעיות של מתכל — מעברים בין דוברים/כלים תוך שמירה על סכום כללי. סיפור: א נותן ל-ב, מה קורה?',
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
    console.error(`[fail] ${input.lessonName} — ${msg.slice(0, 200)}`)
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
  console.log(`║ 8TH GRADE ALGEBRA RETRY: ${LESSONS.length} lessons, concurrency=${CONCURRENCY}`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()
  const outcomes: LessonOutcome[] = []
  for (let i = 0; i < LESSONS.length; i += CONCURRENCY) {
    const batch = LESSONS.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(runOne))
    outcomes.push(...results)
  }

  const lines: string[] = []
  lines.push(`# 8th Grade Algebra Retry — ${LESSONS.length} lessons`)
  lines.push('')
  lines.push(`- **Total wall time**: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`)
  lines.push(`- **Concurrency**: ${CONCURRENCY}`)
  lines.push('')
  lines.push(`| Lesson | Status | Outcome | Blocking (before → after) | Time |`)
  lines.push(`|---|---|---|---|---|`)
  for (const o of outcomes) {
    if (o.ok) {
      lines.push(
        `| ${o.lessonName} | ✅ | ${o.outcome} | ${o.blockingBefore ?? '?'} → ${o.blockingAfter ?? '?'} | ${(o.durationMs / 1000).toFixed(0)}s |`,
      )
    } else {
      lines.push(
        `| ${o.lessonName} | ❌ | — | — | ${(o.durationMs / 1000).toFixed(0)}s |`,
      )
    }
  }
  writeFileSync(resolve(outDir, 'batch-8th-algebra-retry.md'), lines.join('\n'), 'utf8')

  const ok = outcomes.filter((o) => o.ok).length
  console.log('')
  console.log(`══════ RETRY DONE ══════`)
  console.log(`Succeeded: ${ok}/${LESSONS.length}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
