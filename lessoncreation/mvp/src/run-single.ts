/**
 * CLI: run the full pipeline on ONE lesson — a smoke test after
 * prompt / sanity-check changes. Keeps iteration cheap.
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const TARGET: GenerationInput = {
  course: 'כיתה י',
  chapter: 'גיאומטריה',
  lessonName: 'משפט פיתגורס: יישומים',
  prevLesson: '',
  nextLesson: 'משולשים חופפים',
  gradeLevel: '10',
  notes:
    'שיעור יישום פיתגורס בכיתה י\'. התלמיד כבר יודע את המשפט. פתח בבעיה אמיתית (סולם/מרחק/אלכסון). שרטוטים חייבים להיות מגוונים ומדויקים.',
}

async function main() {
  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ SMOKE TEST: ${TARGET.lessonName}`)
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
      `Sketches: ${result.writerSketchSucceeded}/${result.writerSketchCount} materialized (${result.writerSketchFailed} failed)`,
    )
  }
  for (const w of result.writerStructureWarnings ?? []) {
    console.log(`  Writer warn: ${w}`)
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
