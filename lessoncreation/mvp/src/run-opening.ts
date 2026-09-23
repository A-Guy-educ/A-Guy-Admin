/**
 * CLI: iterate on lesson openings (exercises 1-3) cheaply.
 *
 * Skips critic + reviser (they'd flag missing exercises 4-10). Runs:
 *   Planner (full 10-exercise skeleton, needed as writer context)
 *   → Writer with { onlyExercises: [1, 2, 3] }
 *   → Materializer on the shorter output
 *
 * Cost: ~90-120s per iteration vs ~300s for the full pipeline. Meant for
 * fast opening tuning — output goes to `generated-openings/<lesson>.txt`.
 *
 * Set OPENING_LESSON environment variable to pick a different target from
 * the built-in list. Defaults to Pythagoras.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { planLesson } from './planner/plan-lesson.js'
import type { GenerationInput } from './planner/types.js'
import { writeLesson } from './writer/write-lesson.js'

const TARGETS: Record<string, GenerationInput> = {
  pythagoras: {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משפט פיתגורס: יישומים',
    prevLesson: '',
    nextLesson: 'משולשים חופפים',
    gradeLevel: '10',
    notes:
      'שיעור יישום פיתגורס בכיתה י\'. התלמיד כבר יודע את המשפט. פתיחה חמה — יישום ישיר עם מספרים קלים.',
  },
  factoring: {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'פירוק לגורמים: נוסחאות כפל מקוצר',
    prevLesson: 'פירוק לגורמים: הוצאת גורם משותף',
    nextLesson: 'פתרון משוואה ריבועית על ידי פירוק',
    gradeLevel: '10',
    notes:
      'נוסחאות: (a+b)², (a-b)², a²-b². התלמיד כבר יודע לפרק גורם משותף. פתיחה סימבולית ישירה — לא צריך רקטנגלים חזותיים לפירוק.',
  },
  congruent: {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משולשים חופפים',
    prevLesson: 'משפט פיתגורס: יישומים',
    nextLesson: 'משולשים דומים',
    gradeLevel: '10',
    notes:
      'משפטי חפיפה: צ.ז.צ, ז.צ.ז, צ.צ.צ. חשוב מאוד: הפתיחה חייבת להיות על חפיפה, לא על ידע מוקדם כמו פיתגורס.',
  },
  trig: {
    course: 'כיתה י',
    chapter: 'טריגונומטריה במשולש ישר-זווית',
    lessonName: 'הגדרת סינוס, קוסינוס וטנגנס',
    prevLesson: 'משולשים דומים',
    nextLesson: 'חישוב צלעות במשולש ישר-זווית',
    gradeLevel: '10',
    notes: 'הצג sin/cos/tan כיחסי צלעות במשולש ישר-זווית. שיעור מבוא — התלמיד עוד לא ראה sin/cos/tan.',
  },
}

const ONLY_EXERCISES = [1, 2, 3]

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

async function main() {
  const targetKey = (process.env.OPENING_LESSON ?? 'pythagoras').toLowerCase()
  const target = TARGETS[targetKey]
  if (!target) {
    const keys = Object.keys(TARGETS).join(', ')
    console.error(`Unknown OPENING_LESSON="${targetKey}". Valid: ${keys}`)
    process.exit(1)
  }

  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ OPENING-ONLY (E1-E3): ${target.lessonName}`)
  console.log(`╚═══════════════════════════════════════════════`)

  const t0 = Date.now()

  console.log(`━━━ [Planner] full skeleton (for writer context) ━━━`)
  const skeleton = await planLesson(target)
  const t1 = Date.now()
  console.log(`  ✓ ${((t1 - t0) / 1000).toFixed(1)}s`)

  console.log(`━━━ [Writer] exercises ${ONLY_EXERCISES.join(', ')} only ━━━`)
  const result = await writeLesson(skeleton, { onlyExercises: ONLY_EXERCISES })
  const t2 = Date.now()
  console.log(
    `  ✓ ${((t2 - t1) / 1000).toFixed(1)}s | ${result.text.length} chars | sketches: ${result.sketchSucceeded}/${result.sketchCount}`,
  )
  if (result.structureWarnings.length > 0) {
    console.log(`  Warnings:`)
    for (const w of result.structureWarnings) console.log(`    ${w}`)
  }

  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-openings')
  mkdirSync(outDir, { recursive: true })
  const stem = safeName(target.lessonName)
  const outPath = resolve(outDir, `${stem}.txt`)
  writeFileSync(outPath, result.text, 'utf8')

  console.log('')
  console.log(`Total: ${((t2 - t0) / 1000).toFixed(1)}s → ${outPath.replace(process.cwd(), '.')}`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
