/**
 * Retry the 3 coord-geometry lessons that failed on the earlier batch:
 *   - שיפוע של ישר (503 exhausted)
 *   - מצב הדדי בין ישרים (503 exhausted)
 *   - קטעים מקבילים לצירים (schema validation)
 *
 * Runs sequentially with the beefier retry helper (7 attempts, ~24 min
 * budget per call, now catches schema-validation as retriable).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const COURSE = 'כיתה ח'

const LESSONS: GenerationInput[] = [
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'שיפוע של ישר',
    prevLesson: 'ייצוג אלגברי של ישר — מבוא',
    nextLesson: 'מציאת ייצוג אלגברי של ישר',
    gradeLevel: '8',
    notes:
      'מושג השיפוע — עלייה/ירידה, שינוי y חלקי שינוי x. m חיובי/שלילי/אפס. חישוב שיפוע משתי נקודות. פרשנות גיאומטרית של m.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'מצב הדדי בין ישרים',
    prevLesson: 'מציאת ייצוג אלגברי של ישר',
    nextLesson: 'נקודות חיתוך עם הצירים',
    gradeLevel: '8',
    notes:
      'שני ישרים במערכת צירים: מקבילים (שיפועים שווים, חיתוכים שונים), חופפים (שיפועים וחיתוכים שווים), נחתכים (שיפועים שונים). בדיקת המצב מתוך המשוואות.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'קטעים מקבילים לצירים',
    prevLesson: 'נקודת חיתוך בין ישרים',
    nextLesson: 'שטחים במערכת צירים',
    gradeLevel: '8',
    notes:
      'ישרים מהצורה y = k (מקביל לציר x) או x = k (מקביל לציר y). אורכי קטעים אנכיים ואופקיים על סמך הפרש קואורדינטות.',
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
  console.log(`║ 8TH COORD-GEO RETRY: ${LESSONS.length} lessons, sequential`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()
  const outcomes: LessonOutcome[] = []
  for (const input of LESSONS) {
    outcomes.push(await runOne(input))
  }

  const lines: string[] = []
  lines.push(`# 8th Grade Coord-Geo Retry`)
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
  writeFileSync(resolve(outDir, 'batch-8th-coord-geo-retry.md'), lines.join('\n'), 'utf8')

  const ok = outcomes.filter((o) => o.ok).length
  console.log('')
  console.log(`══════ RETRY DONE ══════`)
  console.log(`Succeeded: ${ok}/${LESSONS.length}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
