/**
 * Regenerate the 8th-grade algebra lessons from scratch via the full
 * 6-stage pipeline (planner → critics → reviser → per-exercise writer →
 * materializer → reader-critic + auto-patch → boss-format emit).
 *
 * The prev/next lesson names follow the boss's sequential numbering — even
 * when adjacent lessons cross topic areas (e.g. lesson 2 is followed by
 * lesson 3 which is coord-geometry rather than algebra) — because that's
 * the actual curriculum flow. Skipping to "next algebra lesson" would
 * misrepresent the pedagogical sequence.
 *
 * Concurrency 3 keeps us within Gemini's rate limits while trimming wall
 * time roughly 3x versus fully sequential.
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
    chapter: 'אלגברה',
    lessonName: 'משוואות ממעלה ראשונה',
    prevLesson: '',
    nextLesson: 'משוואות ממעלה ראשונה עם מכנה',
    gradeLevel: '8',
    notes: 'שיעור מבוא בחטיבה — פתרון משוואות ליניאריות בסיסיות. פתיחה חמה עם דוגמאות ויזואליות/אינטואיטיביות.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה',
    lessonName: 'משוואות ממעלה ראשונה עם מכנה',
    prevLesson: 'משוואות ממעלה ראשונה',
    nextLesson: 'נקודות במערכת צירים',
    gradeLevel: '8',
    notes: 'הרחבה — פתרון משוואות עם שברים/מכנים. השתמש בכפל במכנה משותף לצמצום השברים.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — יחס ופרופורציה',
    lessonName: 'יחס — מבוא',
    prevLesson: 'שטחים במערכת צירים',
    nextLesson: 'יחס',
    gradeLevel: '8',
    notes: 'שיעור מבוא ליחס — עקרונות בסיסיים, ייצוגים, אינטואיציה עם דוגמאות מהחיים.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — יחס ופרופורציה',
    lessonName: 'יחס',
    prevLesson: 'יחס — מבוא',
    nextLesson: 'פרופורציה',
    gradeLevel: '8',
    notes: 'העמקה ביחס — פישוט יחסים, יחסים שקולים, יחסים מרובעים (a:b:c).',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — יחס ופרופורציה',
    lessonName: 'פרופורציה',
    prevLesson: 'יחס',
    nextLesson: 'אי שוויון ממעלה ראשונה',
    gradeLevel: '8',
    notes: 'פרופורציה כשוויון יחסים. כפל מוצלב לפתרון משוואות פרופורציה. יישומים בבעיות מילוליות.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה',
    lessonName: 'אי שוויון ממעלה ראשונה',
    prevLesson: 'פרופורציה',
    nextLesson: 'מערכת משוואות — הצבה',
    gradeLevel: '8',
    notes: 'אי-שוויונות ליניאריים. הכללים: חיבור/חיסור לא משנה כיוון, כפל/חילוק במספר שלילי הופך את הכיוון. ייצוג על ציר.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — מערכות משוואות',
    lessonName: 'מערכת משוואות — הצבה',
    prevLesson: 'אי שוויון ממעלה ראשונה',
    nextLesson: 'מערכת משוואות — מקדמים זהים',
    gradeLevel: '8',
    notes: 'שיטת הצבה לפתרון מערכות של שתי משוואות בשני נעלמים. אינטואיציה: בידוד משתנה ממשוואה אחת והצבה בשנייה.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — מערכות משוואות',
    lessonName: 'מערכת משוואות — מקדמים זהים',
    prevLesson: 'מערכת משוואות — הצבה',
    nextLesson: 'מערכת משוואות — השוואת מקדמים',
    gradeLevel: '8',
    notes: 'שיטת חיבור/חיסור כשהמקדמים כבר זהים או הפוכים. חיבור/חיסור ישיר של המשוואות לצמצום נעלם.',
  },
  {
    course: COURSE,
    chapter: 'אלגברה — מערכות משוואות',
    lessonName: 'מערכת משוואות — השוואת מקדמים',
    prevLesson: 'מערכת משוואות — מקדמים זהים',
    nextLesson: 'בעיות מילוליות — כלליות',
    gradeLevel: '8',
    notes: 'הרחבת שיטת החיבור/חיסור: כפל משוואה במספר כדי לקבל מקדמים זהים לפני החיבור. השילוב עם השיטות הקודמות.',
  },
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
    const lastReader = result.readerCriticIterations?.[result.readerCriticIterations.length - 1]?.result
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
    console.error(`[fail] ${input.lessonName} — ${msg}`)
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
  console.log(`║ 8TH GRADE ALGEBRA BATCH: ${LESSONS.length} lessons, concurrency=${CONCURRENCY}`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()
  const outcomes: LessonOutcome[] = []
  for (let i = 0; i < LESSONS.length; i += CONCURRENCY) {
    const batch = LESSONS.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(runOne))
    outcomes.push(...results)
  }

  // Aggregate report
  const lines: string[] = []
  lines.push(`# 8th Grade Algebra Batch — ${LESSONS.length} lessons`)
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
      lines.push(`| ${o.lessonName} | ❌ | — | — | — | ${(o.durationMs / 1000).toFixed(0)}s | ${o.err?.slice(0, 60)}`)
    }
  }
  lines.push('')
  lines.push(`## Aggregate`)
  lines.push('')
  lines.push(`- **Succeeded**: ${succeeded}/${LESSONS.length}`)
  lines.push(`- **Fully clean after auto-patch (0 blocking)**: ${clean}/${succeeded}`)
  lines.push(`- **Total blocking**: ${sumBlockingBefore} → ${sumBlockingAfter}`)

  const reportPath = resolve(outDir, 'batch-8th-algebra.md')
  writeFileSync(reportPath, lines.join('\n'), 'utf8')

  console.log('')
  console.log(`══════ BATCH DONE ══════`)
  console.log(`Succeeded: ${succeeded}/${LESSONS.length} | fully clean: ${clean}/${succeeded}`)
  console.log(`Report: ${reportPath}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
