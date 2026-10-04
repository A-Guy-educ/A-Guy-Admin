/**
 * Re-run the 3 worst-offender 8th grade lessons from scratch with an
 * extra reader-critic + auto-patch iteration (READER_MAX_ITERATIONS=3).
 *
 * Since we deleted the internal v2 .txt files and kept only .boss.txt
 * (which our pipeline can't read back), the cheapest way to "fix" these
 * lessons is a full regeneration. Bumped iter limit gives an extra
 * auto-patch pass on top of the standard 2 iterations.
 *
 * Targets:
 *   1. חפיפת משולשים — צ.צ.צ (previous: 1→4 regression)
 *   2. שטחים במערכת צירים (previous: 14→6)
 *   3. פונקציות קוויות (previous: 3→3, no improvement)
 *
 * Sequential to keep the runtime predictable. Retry-safe pipeline handles
 * Google's flakiness. Output overwrites the existing folder files.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

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
      chapter: 'גיאומטריה — חפיפת משולשים',
      lessonName: 'חפיפת משולשים — צ.צ.צ',
      prevLesson: 'חפיפת משולשים — ז.צ.ז',
      nextLesson: 'טענה ונימוק — מבוא',
      gradeLevel: '8',
      notes:
        'משפט חפיפה צ.צ.צ (שלוש צלעות שוות). סיכום שלושת משפטי החפיפה שלמדנו. תרגול זיהוי איזה משפט מתאים לנתונים. הימנע מלהכניס פרטים שלא הוצגו קודם (לא לרמוז לתלמידים בהנחיה מה משפט החפיפה שיש להוכיח).',
    },
    targetFolder: 'geometry',
  },
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

    // Move the newly-generated .boss.txt into the target folder, overwrite the
    // stale one, and delete the .txt (internal v2) since we only keep boss.
    const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-lessons')
    const targetDir = resolve(outDir, target.targetFolder)
    mkdirSync(targetDir, { recursive: true })
    const bossPath = resolve(outDir, `${stem}.boss.txt`)
    const v2Path = resolve(outDir, `${stem}.txt`)
    if (existsSync(bossPath)) {
      copyFileSync(bossPath, resolve(targetDir, `${stem}.txt`))
      writeFileSync(bossPath, '') // wipe the top-level artifact
    }
    if (existsSync(v2Path)) {
      writeFileSync(v2Path, '') // wipe the top-level v2 artifact too
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
