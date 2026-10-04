/**
 * Regenerate the 8th-grade coordinate-geometry lessons (3-11).
 *
 * These lessons involve simple coordinate-plane drawings (points on a
 * grid, straight lines, intersections) — our materializer's compact DSL
 * handles this well. No proofs or complex geometric constructions.
 *
 * Runs on the retry-safe pipeline (withHttpRetry wraps every Gemini call),
 * so transient 503s from Google recover automatically.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const CONCURRENCY = 3
const COURSE = 'כיתה ח'

const LESSONS: GenerationInput[] = [
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'נקודות במערכת צירים',
    prevLesson: 'משוואות ממעלה ראשונה עם מכנה',
    nextLesson: 'ייצוג אלגברי של ישר — מבוא',
    gradeLevel: '8',
    notes:
      'שיעור מבוא למערכת צירים דו-ממדית. הגדרת נקודה על ידי (x, y). הבחנה בין ארבעת הרביעים. סימון נקודות על גרף וקריאת קואורדינטות שלהן.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'ייצוג אלגברי של ישר — מבוא',
    prevLesson: 'נקודות במערכת צירים',
    nextLesson: 'שיפוע של ישר',
    gradeLevel: '8',
    notes:
      'מבוא לישר במערכת צירים. משוואה מהצורה y = mx + n. בדיקה האם נקודה נמצאת על ישר על ידי הצבה. שרטוט ישרים פשוטים.',
  },
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
    lessonName: 'מציאת ייצוג אלגברי של ישר',
    prevLesson: 'שיפוע של ישר',
    nextLesson: 'מצב הדדי בין ישרים',
    gradeLevel: '8',
    notes:
      'בהינתן נקודה+שיפוע או שתי נקודות — מציאת המשוואה y = mx + n. שלבי הפתרון: חישוב m, הצבת נקודה למציאת n.',
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
    lessonName: 'נקודות חיתוך עם הצירים',
    prevLesson: 'מצב הדדי בין ישרים',
    nextLesson: 'נקודת חיתוך בין ישרים',
    gradeLevel: '8',
    notes:
      'חיתוך ישר עם ציר x: הצבת y=0. חיתוך עם ציר y: הצבת x=0. פירוש גרפי של הפרמטר n כחיתוך עם ציר y.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'נקודת חיתוך בין ישרים',
    prevLesson: 'נקודות חיתוך עם הצירים',
    nextLesson: 'קטעים מקבילים לצירים',
    gradeLevel: '8',
    notes:
      'מציאת נקודת החיתוך של שני ישרים — פתרון מערכת של שתי משוואות. חיבור לשיטת ההצבה שנלמדה קודם. משמעות גרפית: נקודה על שני הישרים.',
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
  {
    course: COURSE,
    chapter: 'גיאומטריית קואורדינטות',
    lessonName: 'שטחים במערכת צירים',
    prevLesson: 'קטעים מקבילים לצירים',
    nextLesson: 'יחס — מבוא',
    gradeLevel: '8',
    notes:
      'חישוב שטחים של צורות פשוטות (מלבן, משולש, טרפז) שקודקודיהן נקודות במערכת צירים. שימוש בקטעים אנכיים ואופקיים כאורך/רוחב.',
  },
]

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

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
  console.log(`║ 8TH COORD-GEOMETRY BATCH: ${LESSONS.length} lessons, concurrency=${CONCURRENCY}`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()
  const outcomes: LessonOutcome[] = []
  for (let i = 0; i < LESSONS.length; i += CONCURRENCY) {
    const batch = LESSONS.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(runOne))
    outcomes.push(...results)
  }

  const lines: string[] = []
  lines.push(`# 8th Grade Coord-Geometry Batch — ${LESSONS.length} lessons`)
  lines.push('')
  lines.push(`- **Total wall time**: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`)
  lines.push(`- **Concurrency**: ${CONCURRENCY}`)
  lines.push('')
  lines.push(`| Lesson | Status | Outcome | Blocking (before → after) | Chars | Time |`)
  lines.push(`|---|---|---|---|---|---|`)
  let succeeded = 0
  let clean = 0
  let sumBlockingBefore = 0
  let sumBlockingAfter = 0
  for (const o of outcomes) {
    if (o.ok) {
      succeeded++
      if ((o.blockingAfter ?? Infinity) === 0) clean++
      sumBlockingBefore += o.blockingBefore ?? 0
      sumBlockingAfter += o.blockingAfter ?? 0
      lines.push(
        `| ${o.lessonName} | ✅ | ${o.outcome} | ${o.blockingBefore ?? '?'} → ${o.blockingAfter ?? '?'} | ${o.chars ?? '?'} | ${(o.durationMs / 1000).toFixed(0)}s |`,
      )
    } else {
      lines.push(`| ${o.lessonName} | ❌ | — | — | — | ${(o.durationMs / 1000).toFixed(0)}s |`)
    }
  }
  lines.push('')
  lines.push(`## Aggregate`)
  lines.push('')
  lines.push(`- **Succeeded**: ${succeeded}/${LESSONS.length}`)
  lines.push(`- **Fully clean after auto-patch (0 blocking)**: ${clean}/${succeeded}`)
  lines.push(`- **Total blocking**: ${sumBlockingBefore} → ${sumBlockingAfter}`)

  writeFileSync(resolve(outDir, 'batch-8th-coord-geo.md'), lines.join('\n'), 'utf8')

  console.log('')
  console.log(`══════ BATCH DONE ══════`)
  console.log(`Succeeded: ${succeeded}/${LESSONS.length} | fully clean: ${clean}/${succeeded}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
