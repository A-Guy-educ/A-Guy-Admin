/**
 * CLI: run the full Planner → Critic → Reviser loop on the 3 test lessons.
 * Reports iteration counts, final pass/fail, and total wall time per lesson.
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const TARGETS: GenerationInput[] = [
  {
    course: 'כיתה ז׳',
    chapter: 'אלגברה',
    lessonName: 'חוק הפילוג',
    prevLesson: 'ביטויים אלגבריים — בסיס',
    nextLesson: 'משוואות: מבוא',
    gradeLevel: '7',
    notes: '',
  },
  {
    course: 'כיתה ז׳',
    chapter: 'גיאומטריה',
    lessonName: 'שטח והיקף של מלבן',
    prevLesson: 'תכונות מלבן',
    nextLesson: 'גובה במשולש',
    gradeLevel: '7',
    notes: '',
  },
  {
    course: 'כיתה ז׳',
    chapter: 'אלגברה',
    lessonName: 'חוקיות',
    prevLesson: '',
    nextLesson: 'ביטויים אלגבריים — בסיס',
    gradeLevel: '7',
    notes: '',
  },
]

async function main() {
  const results = []
  for (const target of TARGETS) {
    const result = await runPipeline(target)
    results.push(result)
  }

  console.log('')
  console.log('═══════════════ SUMMARY ═══════════════')
  console.log('')
  for (const r of results) {
    const status =
      r.outcome === 'PASS_CLEAN'
        ? '✅ PASS-CLEAN'
        : r.outcome === 'PASS_WITH_NOTES'
          ? '☑️  PASS-WITH-NOTES'
          : '⚠️  HALT'
    const secs = (r.totalDurationMs / 1000).toFixed(1)
    console.log(`${status} — ${r.input.lessonName} — ${r.iterations.length} iter — ${secs}s`)
    for (const iter of r.iterations) {
      const crit = iter.verdict.findings.filter((f) => f.severity === 'CRITICAL').length
      const high = iter.verdict.findings.filter((f) => f.severity === 'HIGH').length
      const patchedStr = iter.patchedNumbers.length
        ? `patched [${iter.patchedNumbers.join(',')}]`
        : 'no patches'
      console.log(
        `    iter ${iter.iterationNumber}: CRIT:${crit} HIGH:${high} → ${patchedStr}`,
      )
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
