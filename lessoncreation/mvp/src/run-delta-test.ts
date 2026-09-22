/**
 * CLI: rerun 3 grade-10 lessons that showed problems before the merge:
 *   - משפט פיתגורס: יישומים  (was "childish" per user)
 *   - פירוק לגורמים: נוסחאות כפל מקוצר  (had 577-segment degeneration)
 *   - משולשים חופפים  (fell back to SVG instead of DSL)
 *
 * These are the same targets from the earlier batch. Running them through
 * the merged pipeline lets us measure the grade-10 calibration delta.
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const TARGETS: GenerationInput[] = [
  {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משפט פיתגורס: יישומים',
    prevLesson: '',
    nextLesson: 'משולשים חופפים',
    gradeLevel: '10',
    notes: 'שיעור יישום של פיתגורס בכיתה י\'. התלמיד כבר יודע את המשפט מהחטיבה — אין ללמד מחדש. פתח בבעיה אמיתית (סולם/מרחק/אלכסון).',
  },
  {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'פירוק לגורמים: נוסחאות כפל מקוצר',
    prevLesson: 'פירוק לגורמים: הוצאת גורם משותף',
    nextLesson: 'פתרון משוואה ריבועית על ידי פירוק',
    gradeLevel: '10',
    notes: 'נוסחאות: (a+b)², (a-b)², a²-b². התלמיד כבר יודע לפרק גורם משותף. שרטוטים חזותיים — ריבועים ומלבנים לפירוק גיאומטרי. אל תפול לרפטיציה בקטעים.',
  },
  {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משולשים חופפים',
    prevLesson: 'משפט פיתגורס: יישומים',
    nextLesson: 'משולשים דומים',
    gradeLevel: '10',
    notes: 'משפטי חפיפה: צ.ז.צ, ז.צ.ז, צ.צ.צ. השתמש בשרטוטי DSL עם צלעות מסומנות ערכים וזוויות מוגדרות. אל תפתח ב"אילו שתי צורות זהות" — התלמיד כבר יודע מה זה שוויון. פתח בבעיה: נתונים במשולש → האם חופף?',
  },
]

async function main() {
  const results = []
  for (const target of TARGETS) {
    console.log('')
    console.log(`╔═══════════════════════════════════════════════`)
    console.log(`║ ${target.lessonName}`)
    console.log(`╚═══════════════════════════════════════════════`)
    try {
      const result = await runPipeline(target)
      results.push(result)
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : err}`)
      results.push(null)
    }
  }

  console.log('')
  console.log('═══════════ DELTA-TEST SUMMARY ═══════════')
  for (const r of results) {
    if (!r) {
      console.log(`❌ FAILED`)
      continue
    }
    const outcome =
      r.outcome === 'PASS_CLEAN'
        ? '✅ CLEAN'
        : r.outcome === 'PASS_WITH_NOTES'
          ? '☑️  NOTES'
          : '⚠️  HALT'
    const writer = r.writerParseOk
      ? (r.writerStructureWarnings?.length ?? 0) === 0
        ? 'WRITE-CLEAN'
        : `WRITE-WARN(${r.writerStructureWarnings?.length})`
      : 'WRITE-FAIL'
    const secs = (r.totalDurationMs / 1000).toFixed(0)
    console.log(`${outcome} | ${writer} | ${secs}s — ${r.input.lessonName}`)
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
