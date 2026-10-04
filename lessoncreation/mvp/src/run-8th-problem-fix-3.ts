/**
 * Third fix pass — the 4 remaining "moderate" lessons that had 2-3
 * residual blocking findings after the original batch. Re-run with
 * READER_MAX_ITERATIONS=3 to squeeze more out.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const COURSE = 'כיתה ח'

interface Target {
  input: GenerationInput
  targetFolder: string
}

const TARGETS: Target[] = [
  {
    input: {
      course: COURSE,
      chapter: 'אלגברה',
      lessonName: 'משוואות ממעלה ראשונה עם מכנה',
      prevLesson: 'משוואות ממעלה ראשונה',
      nextLesson: 'נקודות במערכת צירים',
      gradeLevel: '8',
      notes:
        'הרחבה — פתרון משוואות עם שברים/מכנים. השתמש בכפל במכנה משותף לצמצום השברים. חובה: הצג כל שלב פתרון בברירות, ואל תרמוז את התשובה בהנחיה או במסיחים.',
    },
    targetFolder: 'algebra',
  },
  {
    input: {
      course: COURSE,
      chapter: 'אלגברה — מערכות משוואות',
      lessonName: 'מערכת משוואות — השוואת מקדמים',
      prevLesson: 'מערכת משוואות — מקדמים זהים',
      nextLesson: 'בעיות מילוליות — כלליות',
      gradeLevel: '8',
      notes:
        'הרחבת שיטת החיבור/חיסור: כפל משוואה במספר כדי לקבל מקדמים זהים לפני החיבור. השילוב עם השיטות הקודמות. חובה: כל תרגיל יראה במפורש את שני הבחירות (איזו משוואה להכפיל ובכמה).',
    },
    targetFolder: 'algebra',
  },
  {
    input: {
      course: COURSE,
      chapter: 'גיאומטריית קואורדינטות',
      lessonName: 'נקודות במערכת צירים',
      prevLesson: 'משוואות ממעלה ראשונה עם מכנה',
      nextLesson: 'ייצוג אלגברי של ישר — מבוא',
      gradeLevel: '8',
      notes:
        'שיעור מבוא למערכת צירים דו-ממדית. הגדרת נקודה על ידי (x, y). הבחנה בין ארבעת הרביעים. סימון נקודות על גרף וקריאת קואורדינטות שלהן. חובה: תרגילים 1-3 תפיסתיים בלבד (זיהוי, לא חישוב). כל שרטוט חייב להכיל צירים מסומנים.',
    },
    targetFolder: 'coord-geo',
  },
  {
    input: {
      course: COURSE,
      chapter: 'גיאומטריית קואורדינטות',
      lessonName: 'מצב הדדי בין ישרים',
      prevLesson: 'מציאת ייצוג אלגברי של ישר',
      nextLesson: 'נקודות חיתוך עם הצירים',
      gradeLevel: '8',
      notes:
        'שני ישרים במערכת צירים: מקבילים (שיפועים שווים, חיתוכים שונים), חופפים (שיפועים וחיתוכים שווים), נחתכים (שיפועים שונים). בדיקת המצב מתוך המשוואות. חובה: לכל תרגיל שני הישרים במפורש בצורת y=mx+n.',
    },
    targetFolder: 'coord-geo',
  },
]

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

async function runOne(target: Target): Promise<void> {
  const t0 = Date.now()
  const stem = safeName(target.input.lessonName)
  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ FIX: ${target.input.lessonName} (${target.targetFolder}/)`)
  console.log(`╚═══════════════════════════════════════════════`)

  try {
    const result = await runPipeline(target.input)
    const firstReader = result.readerCriticIterations?.[0]?.result
    const lastReader =
      result.readerCriticIterations?.[result.readerCriticIterations.length - 1]?.result
    const bBefore = firstReader ? firstReader.totalCritical + firstReader.totalHigh : undefined
    const bAfter = lastReader ? lastReader.totalCritical + lastReader.totalHigh : undefined
    const iters = result.readerCriticIterations?.length ?? 0
    const ms = Date.now() - t0

    const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-lessons')
    const targetDir = resolve(outDir, target.targetFolder)
    mkdirSync(targetDir, { recursive: true })
    const bossPath = resolve(outDir, `${stem}.boss.txt`)
    const v2Path = resolve(outDir, `${stem}.txt`)
    if (existsSync(bossPath)) {
      copyFileSync(bossPath, resolve(targetDir, `${stem}.txt`))
      writeFileSync(bossPath, '')
    }
    if (existsSync(v2Path)) {
      writeFileSync(v2Path, '')
    }

    console.log('')
    console.log(`══════ DONE ══════`)
    console.log(`Time: ${(ms / 1000).toFixed(0)}s`)
    console.log(`Outcome: ${result.outcome}`)
    console.log(`Reader-critic iters: ${iters}`)
    console.log(`Blocking: ${bBefore ?? '?'} → ${bAfter ?? '?'}`)
    console.log(`Moved to: ${targetDir}/${stem}.txt`)
  } catch (err) {
    console.error('')
    console.error(`❌ FAILED ${target.input.lessonName}: ${err instanceof Error ? err.message : err}`)
  }
}

async function main() {
  console.log('')
  console.log(`Reader-critic iterations: ${process.env.READER_MAX_ITERATIONS ?? '2 (default)'}`)
  for (const target of TARGETS) {
    await runOne(target)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
