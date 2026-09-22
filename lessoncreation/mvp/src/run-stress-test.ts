/**
 * CLI: stress-test the full 4-stage pipeline on two hard lessons:
 *   1. Geometry-heavy — adjacent/vertical angles. Exercises the full
 *      geometry DSL (points, lines, angles, right-angle markers, colored
 *      arcs).
 *   2. Function-heavy — linear function equation. Exercises SVG plotting
 *      of axes, function lines, and points at grade-8 scope.
 *
 * We already know the pipeline handles algebra + basic geometry (rect
 * area/perimeter). These two push harder: complex geometric constructions
 * on one side, coordinate graphs on the other.
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const TARGETS: GenerationInput[] = [
  {
    course: 'כיתה ז׳',
    chapter: 'גיאומטריה',
    lessonName: 'זוויות צמודות וקדקודיות',
    prevLesson: 'הכרת הזווית',
    nextLesson: 'ניצבות והקבלה',
    gradeLevel: '7',
    notes:
      'שיעור גיאומטריה טהור. הכנס שרטוטי DSL מלאים עם נקודות, ישרים, זוויות צבועות (אדום/כחול/ירוק/כתום), וסימוני זווית ישרה כשרלוונטי. אל תשתמש ב-SVG לתיאור הגיאומטריה — השתמש רק ב-DSL של --- נקודות ---, --- ישרים ---, --- זוויות ---.',
  },
  {
    course: 'כיתה ח׳',
    chapter: 'פונקציות',
    lessonName: 'פונקציה קווית: משוואת ישר y = mx + b',
    prevLesson: 'מערכת צירים',
    nextLesson: 'שיפוע של ישר',
    gradeLevel: '8',
    notes:
      'שיעור מבוא לפונקציה קווית. השרטוטים חייבים לכלול מערכת צירים (x,y), נקודות ממוספרות על הגרף, וישרים עם שיפועים שונים. השתמש ב-SVG פשוט לגרפים — צייר צירים עם קווים אנכיים/אופקיים, סמן ראשית, סרטט נקודות עם circle, ישרים עם line. שמור על סקאלה פרופורציונית (כל יחידה = 20 פיקסלים לדוגמה).',
  },
]

async function main() {
  const results = []
  for (const target of TARGETS) {
    const result = await runPipeline(target)
    results.push(result)
  }

  console.log('')
  console.log('═══════════════ STRESS-TEST SUMMARY ═══════════════')
  console.log('')
  for (const r of results) {
    const outcome =
      r.outcome === 'PASS_CLEAN'
        ? '✅ PASS-CLEAN'
        : r.outcome === 'PASS_WITH_NOTES'
          ? '☑️  PASS-WITH-NOTES'
          : '⚠️  HALT'
    const writer = r.writerParseOk
      ? (r.writerStructureWarnings?.length ?? 0) === 0
        ? '✅ WRITE-CLEAN'
        : `⚠️  WRITE-WARN(${r.writerStructureWarnings?.length})`
      : '❌ WRITE-FAIL'
    const secs = (r.totalDurationMs / 1000).toFixed(1)
    console.log(`${outcome} | ${writer} — ${r.input.lessonName} — ${secs}s`)
    for (const iter of r.iterations) {
      const crit = iter.verdict.findings.filter((f) => f.severity === 'CRITICAL').length
      const high = iter.verdict.findings.filter((f) => f.severity === 'HIGH').length
      const patched = iter.patchedNumbers.length
        ? `patched [${iter.patchedNumbers.join(',')}]`
        : 'no patches'
      console.log(`    iter ${iter.iterationNumber}: CRIT:${crit} HIGH:${high} → ${patched}`)
    }
    if (r.writerParseError) console.log(`    writer error: ${r.writerParseError}`)
    if (r.writerStructureWarnings?.length) {
      for (const w of r.writerStructureWarnings) console.log(`    writer warn: ${w}`)
    }
    console.log('')
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
