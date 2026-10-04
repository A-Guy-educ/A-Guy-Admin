/**
 * Final 13-lesson batch for 8th grade — linear functions (22-24) + pure
 * geometry (25-34). Wraps up the 34-lesson corpus.
 *
 * Caveats:
 *  - Linear-function lessons need graph rendering. Our materializer emits
 *    SVG for graphs; quality varies. Boss's structured graph format
 *    (graph_structure_prompt.txt) isn't wired in yet — if he needs that,
 *    we'll do a translation pass after.
 *  - Pure geometry lessons need drawings. Our materializer's compact DSL
 *    (--- נקודות --- / --- קטעים --- / --- זוויות ---) handles basic
 *    triangle drawings. The boss's YAML-nested spec with CONSTRAINTS isn't
 *    wired in either — same translation-pass caveat.
 *
 * Runs on the retry-safe pipeline (7-attempt exponential backoff) at
 * concurrency 3, expected ~1.5-2 hrs wall time.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const CONCURRENCY = 3
const COURSE = 'כיתה ח'

const LESSONS: GenerationInput[] = [
  // --- Linear functions (22-24) ---
  {
    course: COURSE,
    chapter: 'פונקציות',
    lessonName: 'פונקציה קווית — מבוא',
    prevLesson: 'בעיות מילוליות — קנייה ומכירה',
    nextLesson: 'פונקציה קווית',
    gradeLevel: '8',
    notes:
      'מבוא לפונקציה — התאמת ערך יחיד לכל x. פונקציה קווית y = mx + n כמודל מתמטי. דוגמאות מהחיים (מחיר לפי כמות, מרחק לפי זמן). קריאת ערכים מטבלה או מגרף.',
  },
  {
    course: COURSE,
    chapter: 'פונקציות',
    lessonName: 'פונקציה קווית',
    prevLesson: 'פונקציה קווית — מבוא',
    nextLesson: 'פונקציות קוויות',
    gradeLevel: '8',
    notes:
      'העמקה בפונקציה הקווית: תחום הגדרה, טווח, שיפוע ומשמעותו, נקודות חיתוך עם הצירים. מעבר בין נוסחה, טבלה וגרף.',
  },
  {
    course: COURSE,
    chapter: 'פונקציות',
    lessonName: 'פונקציות קוויות',
    prevLesson: 'פונקציה קווית',
    nextLesson: 'קווים מיוחדים במשולש',
    gradeLevel: '8',
    notes:
      'מספר פונקציות קוויות באותו שרטוט. השוואה בין שיפועים. מציאת נקודת חיתוך בין שני גרפים. יישום בבעיות מילוליות (כשעיסוקנים נפגשים).',
  },
  // --- Pure geometry (25-34) ---
  {
    course: COURSE,
    chapter: 'גיאומטריה — משולשים',
    lessonName: 'קווים מיוחדים במשולש',
    prevLesson: 'פונקציות קוויות',
    nextLesson: 'קווים מקבילים',
    gradeLevel: '8',
    notes:
      'תיכון, גובה, חוצה זווית ואנך אמצעי. הגדרות והבחנה ביניהם. תכונות בסיסיות של מפגשי הקווים במשולש.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה',
    lessonName: 'קווים מקבילים',
    prevLesson: 'קווים מיוחדים במשולש',
    nextLesson: 'חפיפת משולשים — צ.ז.צ',
    gradeLevel: '8',
    notes:
      'ישרים מקבילים חתוכים על ידי ישר שלישי. זוויות מתאימות, מתחלפות, שכנות. משפט הזוויות המתאימות ותרגילי הוכחה בסיסיים.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — חפיפת משולשים',
    lessonName: 'חפיפת משולשים — צ.ז.צ',
    prevLesson: 'קווים מקבילים',
    nextLesson: 'חפיפת משולשים — ז.צ.ז',
    gradeLevel: '8',
    notes:
      'משפט חפיפה צ.ז.צ (צלע-זווית-צלע). מהי חפיפה, מה נדרש להוכיח. שימוש בשרטוט עם סימוני צלעות/זוויות שוות. תרגילי הוכחה בסיסיים.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — חפיפת משולשים',
    lessonName: 'חפיפת משולשים — ז.צ.ז',
    prevLesson: 'חפיפת משולשים — צ.ז.צ',
    nextLesson: 'חפיפת משולשים — צ.צ.צ',
    gradeLevel: '8',
    notes:
      'משפט חפיפה ז.צ.ז (זווית-צלע-זווית). זווית כלואה, צלע כלואה. הבחנה מ-צ.ז.צ. תרגילי הוכחה.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — חפיפת משולשים',
    lessonName: 'חפיפת משולשים — צ.צ.צ',
    prevLesson: 'חפיפת משולשים — ז.צ.ז',
    nextLesson: 'טענה ונימוק — מבוא',
    gradeLevel: '8',
    notes:
      'משפט חפיפה צ.צ.צ (שלוש צלעות שוות). סיכום שלושת משפטי החפיפה שלמדנו. תרגול זיהוי איזה משפט מתאים לנתונים.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — טענה ונימוק',
    lessonName: 'טענה ונימוק — מבוא',
    prevLesson: 'חפיפת משולשים — צ.צ.צ',
    nextLesson: 'טענה ונימוק',
    gradeLevel: '8',
    notes:
      'מבוא לבניית הוכחה גיאומטרית: מבנה טענה-נימוק. זיהוי נתונים, חיפוש קשרים, שרשור מסקנות עם הצדקות (אקסיומה, משפט, נתון).',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — טענה ונימוק',
    lessonName: 'טענה ונימוק',
    prevLesson: 'טענה ונימוק — מבוא',
    nextLesson: 'משולש שווה שוקיים — תכונות',
    gradeLevel: '8',
    notes:
      'הרחבה של בניית הוכחות עם משפטי חפיפה. תרגילי הוכחה מורכבים יותר. שילוב של תכונות ישרים מקבילים וחפיפת משולשים.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — משולש שווה שוקיים',
    lessonName: 'משולש שווה שוקיים — תכונות',
    prevLesson: 'טענה ונימוק',
    nextLesson: 'משולש שווה שוקיים — חישוב',
    gradeLevel: '8',
    notes:
      'הגדרת משולש שווה שוקיים. תכונות: זוויות בסיס שוות, גובה = תיכון = חוצה זווית מקודקוד הראש. הוכחת התכונות באמצעות חפיפה.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — משולש שווה שוקיים',
    lessonName: 'משולש שווה שוקיים — חישוב',
    prevLesson: 'משולש שווה שוקיים — תכונות',
    nextLesson: 'משולש שווה שוקיים — הוכחה',
    gradeLevel: '8',
    notes:
      'תרגילי חישוב עם משולש שווה שוקיים: מציאת זוויות ואורכי צלעות. שימוש בסכום הזוויות במשולש (180°) ובתכונות הבסיס השוות.',
  },
  {
    course: COURSE,
    chapter: 'גיאומטריה — משולש שווה שוקיים',
    lessonName: 'משולש שווה שוקיים — הוכחה',
    prevLesson: 'משולש שווה שוקיים — חישוב',
    nextLesson: '',
    gradeLevel: '8',
    notes:
      'תרגילי הוכחה מלאה על משולש שווה שוקיים. הוכחת התכונות + הוכחת המשפט ההפוך (משולש עם שתי זוויות שוות הוא שווה שוקיים).',
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
  console.log(`║ 8TH GRADE FINAL BATCH: ${LESSONS.length} lessons, concurrency=${CONCURRENCY}`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()
  const outcomes: LessonOutcome[] = []
  for (let i = 0; i < LESSONS.length; i += CONCURRENCY) {
    const batch = LESSONS.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(runOne))
    outcomes.push(...results)
  }

  const lines: string[] = []
  lines.push(`# 8th Grade Final Batch — ${LESSONS.length} lessons`)
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

  writeFileSync(resolve(outDir, 'batch-8th-final.md'), lines.join('\n'), 'utf8')

  console.log('')
  console.log(`══════ BATCH DONE ══════`)
  console.log(`Succeeded: ${succeeded}/${LESSONS.length} | fully clean: ${clean}/${succeeded}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
