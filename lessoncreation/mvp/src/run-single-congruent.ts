/**
 * Smoke test — run full pipeline (now including reader critic loop) on
 * congruent triangles. Previous version had a "different orientations"
 * bug in E2 that structural checks didn't catch. Reader critic should
 * flag it and trigger a writer regen.
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const TARGET: GenerationInput = {
  course: 'כיתה י',
  chapter: 'גיאומטריה',
  lessonName: 'משולשים חופפים',
  prevLesson: 'משפט פיתגורס: יישומים',
  nextLesson: 'משולשים דומים',
  gradeLevel: '10',
  notes:
    'משפטי חפיפה: צ.ז.צ, ז.צ.ז, צ.צ.צ. הפתיחה חייבת להיות על חפיפה, לא על ידע מוקדם כמו פיתגורס.',
}

async function main() {
  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ SMOKE TEST (with reader critic): ${TARGET.lessonName}`)
  console.log(`╚═══════════════════════════════════════════════`)
  const result = await runPipeline(TARGET)
  console.log('')
  console.log('══════ SMOKE-TEST SUMMARY ══════')
  const outcome =
    result.outcome === 'PASS_CLEAN'
      ? '✅ CLEAN'
      : result.outcome === 'PASS_WITH_NOTES'
        ? '☑️  NOTES'
        : '⚠️  HALT'
  const writer = result.writerParseOk
    ? (result.writerStructureWarnings?.length ?? 0) === 0
      ? '✅ WRITE-CLEAN'
      : `⚠️  WRITE-WARN(${result.writerStructureWarnings?.length})`
    : '❌ WRITE-FAIL'
  const secs = (result.totalDurationMs / 1000).toFixed(0)
  console.log(`Skeleton: ${outcome} in ${result.iterations.length} iter | Writer: ${writer} | ${secs}s`)
  if (result.writerSketchCount !== undefined) {
    console.log(
      `Sketches: ${result.writerSketchSucceeded}/${result.writerSketchCount} materialized`,
    )
  }
  if (result.readerCriticIterations && result.readerCriticIterations.length > 0) {
    console.log(`Reader critic:`)
    for (const iter of result.readerCriticIterations) {
      const { totalCritical, totalHigh, totalMedium, totalLow } = iter.result
      const patched = iter.patchedNumbers.length > 0
        ? `patched [${iter.patchedNumbers.join(',')}]`
        : 'no patches'
      console.log(
        `  iter ${iter.iterationNumber}: CRIT:${totalCritical} HIGH:${totalHigh} MED:${totalMedium} LOW:${totalLow} → ${patched}`,
      )
      // Show top findings from CRITICAL/HIGH.
      for (const v of iter.result.verdicts) {
        const blocking = v.findings.filter(
          (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
        )
        if (blocking.length === 0) continue
        console.log(`    E${v.exerciseNumber}:`)
        for (const f of blocking) {
          console.log(`      [${f.severity}] ${f.sectionLetter}: ${f.issue}`)
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
