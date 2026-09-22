/**
 * CLI: run the critic on every skeleton in `generated-skeletons/` and
 * print the verdicts. Used during development to compare the automated
 * critic's findings against the human sub-agent verdicts we already have.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { critiqueSkeleton } from './critic/critique-skeleton.js'
import type { LessonSkeleton } from './planner/schema.js'

async function main() {
  const skeletonsDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-skeletons')
  const verdictsDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-verdicts')
  mkdirSync(verdictsDir, { recursive: true })

  const files = readdirSync(skeletonsDir).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    console.error('No skeletons found. Run run-planner.ts first.')
    process.exit(1)
  }

  for (const file of files) {
    const path = resolve(skeletonsDir, file)
    const skeleton = JSON.parse(readFileSync(path, 'utf8')) as LessonSkeleton

    console.log('')
    console.log(`━━━ Critiquing: ${skeleton.lessonName} ━━━`)
    const start = Date.now()
    try {
      const verdict = await critiqueSkeleton(skeleton)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)

      writeFileSync(
        resolve(verdictsDir, file),
        JSON.stringify(verdict, null, 2),
        'utf8',
      )

      console.log(`✓ ${elapsed}s | ${verdict.overallVerdict} | ${verdict.findings.length} findings`)
      console.log(`Summary: ${verdict.summary}`)
      for (const f of verdict.findings) {
        const loc = f.exerciseNumber === 0 ? 'lesson-level' : `E${f.exerciseNumber}`
        console.log(`  [${f.severity}] ${loc} (${f.rule}): ${f.issue}`)
        console.log(`      Fix: ${f.suggestedFix}`)
      }
    } catch (err) {
      console.error(`✗ FAILED: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log('')
  console.log(`Verdicts written to: lessoncreation/mvp/generated-verdicts/`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
