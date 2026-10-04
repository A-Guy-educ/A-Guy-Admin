/**
 * Final straggler — בעיות מילוליות — קנייה ומכירה. Failed on the earlier
 * retry-safe batch because the "fetch failed" network-error pattern wasn't
 * matched as retriable. That's fixed now (http-retry.ts).
 */
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const INPUT: GenerationInput = {
  course: 'כיתה ח',
  chapter: 'אלגברה — בעיות מילוליות',
  lessonName: 'בעיות מילוליות — קנייה ומכירה',
  prevLesson: 'בעיות מילוליות — העברה',
  nextLesson: 'פונקציה קווית — מבוא',
  gradeLevel: '8',
  notes: 'בעיות עסקיות: מחיר יחידה × כמות = מחיר כולל. הנחות, מבצעים, השוואות של אפשרויות רכישה.',
}

async function main() {
  const t0 = Date.now()
  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ FINAL STRAGGLER: ${INPUT.lessonName}`)
  console.log(`╚═══════════════════════════════════════════════`)

  try {
    const result = await runPipeline(INPUT)
    const firstReader = result.readerCriticIterations?.[0]?.result
    const lastReader =
      result.readerCriticIterations?.[result.readerCriticIterations.length - 1]?.result
    const bBefore = firstReader ? firstReader.totalCritical + firstReader.totalHigh : undefined
    const bAfter = lastReader ? lastReader.totalCritical + lastReader.totalHigh : undefined
    const ms = Date.now() - t0
    console.log('')
    console.log(`══════ DONE ══════`)
    console.log(`Time: ${(ms / 1000).toFixed(0)}s`)
    console.log(`Outcome: ${result.outcome}`)
    console.log(`Blocking: ${bBefore ?? '?'} → ${bAfter ?? '?'}`)
    console.log(`Chars: ${result.lessonText?.length}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('')
    console.error(`❌ FAILED: ${msg}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
