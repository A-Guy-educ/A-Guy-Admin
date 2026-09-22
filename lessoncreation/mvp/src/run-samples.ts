/**
 * CLI: generate a small variety-pack of grade-10 lessons for human eyeball
 * review after the two-stage materializer landed. Picks lessons that
 * previously showed different failure modes so we can see how the
 * materialized output looks across categories:
 *   1. Algebra with visual factoring — previously had 577-segment degeneration
 *   2. Pure geometry (congruent triangles) — previously fell back to SVG
 *   3. Trigonometry (right-triangle definitions) — first materializer run
 *
 * Pythagoras is skipped here since the smoke test already produced it.
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const TARGETS: GenerationInput[] = [
  {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'פירוק לגורמים: נוסחאות כפל מקוצר',
    prevLesson: 'פירוק לגורמים: הוצאת גורם משותף',
    nextLesson: 'פתרון משוואה ריבועית על ידי פירוק',
    gradeLevel: '10',
    notes:
      'נוסחאות: (a+b)², (a-b)², a²-b². התלמיד כבר יודע לפרק גורם משותף. שרטוטים חזותיים — ריבועים ומלבנים לפירוק גיאומטרי אינטואיטיבי.',
  },
  {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משולשים חופפים',
    prevLesson: 'משפט פיתגורס: יישומים',
    nextLesson: 'משולשים דומים',
    gradeLevel: '10',
    notes:
      'משפטי חפיפה: צ.ז.צ, ז.צ.ז, צ.צ.צ. פתח בבעיה — נתונים במשולש → האם חופף למשולש אחר. אל תלמד מחדש מה זה שוויון צורות.',
  },
  {
    course: 'כיתה י',
    chapter: 'טריגונומטריה במשולש ישר-זווית',
    lessonName: 'הגדרת סינוס, קוסינוס וטנגנס',
    prevLesson: 'משולשים דומים',
    nextLesson: 'חישוב צלעות במשולש ישר-זווית',
    gradeLevel: '10',
    notes:
      'הצג sin/cos/tan כיחסי צלעות במשולש ישר-זווית בלבד. אל תיגע במעגל היחידה. שרטוטי משולש ישר-זווית עם צלע נגדית / סמוכה / יתר מוגדרות.',
  },
]

async function main() {
  const results = []
  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i]
    console.log('')
    console.log(`╔═══ [${i + 1}/${TARGETS.length}] ${target.lessonName} ═══╗`)
    try {
      const result = await runPipeline(target)
      results.push({ target, result })
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : err}`)
      results.push({ target, result: null })
    }
  }

  console.log('')
  console.log('═══════════════ SUMMARY ═══════════════')
  for (const { target, result } of results) {
    if (!result) {
      console.log(`❌ ${target.lessonName}: FAILED`)
      continue
    }
    const outcome =
      result.outcome === 'PASS_CLEAN'
        ? '✅ CLEAN'
        : result.outcome === 'PASS_WITH_NOTES'
          ? '☑️  NOTES'
          : '⚠️  HALT'
    const writer = result.writerParseOk
      ? (result.writerStructureWarnings?.length ?? 0) === 0
        ? 'WRITE-CLEAN'
        : `WRITE-WARN(${result.writerStructureWarnings?.length})`
      : 'WRITE-FAIL'
    const sketches =
      result.writerSketchCount !== undefined
        ? `${result.writerSketchSucceeded}/${result.writerSketchCount} sketches`
        : ''
    const secs = (result.totalDurationMs / 1000).toFixed(0)
    console.log(`${outcome} | ${writer} | ${sketches} | ${secs}s — ${target.lessonName}`)
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
