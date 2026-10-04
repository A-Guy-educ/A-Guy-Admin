/**
 * Resume the problem-lesson fix after the PC crash killed the earlier run
 * mid-lesson. First lesson (חפיפת משולשים — צ.צ.צ) finished cleanly and
 * is already in geometry/. This picks up the remaining two.
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
      chapter: 'גיאומטריית קואורדינטות',
      lessonName: 'שטחים במערכת צירים',
      prevLesson: 'קטעים מקבילים לצירים',
      nextLesson: 'יחס — מבוא',
      gradeLevel: '8',
      notes:
        'חישוב שטחים של צורות פשוטות (מלבן, משולש, טרפז) שקודקודיהן נקודות במערכת צירים. שימוש בקטעים אנכיים ואופקיים כאורך/רוחב. חובה לוודא שכל תרגיל נותן את הקואורדינטות במפורש בהנחיה — לא לרמוז בתשובות.',
    },
    targetFolder: 'coord-geo',
  },
  {
    input: {
      course: COURSE,
      chapter: 'פונקציות',
      lessonName: 'פונקציות קוויות',
      prevLesson: 'פונקציה קווית',
      nextLesson: 'קווים מיוחדים במשולש',
      gradeLevel: '8',
      notes:
        'מספר פונקציות קוויות באותו שרטוט. השוואה בין שיפועים. מציאת נקודת חיתוך בין שני גרפים. יישום בבעיות מילוליות (כשעיסוקנים נפגשים). חובה: כל פונקציה תוצג במפורש כ-y = mx + n עם ערכים ברורים.',
    },
    targetFolder: 'functions',
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
