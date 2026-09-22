/**
 * CLI: run the writer on every skeleton in `generated-skeletons/` (the
 * ones the pipeline already produced) and write out the resulting v2
 * `.txt` files to `generated-lessons/`. Reports parse validity and
 * structural warnings per lesson.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import type { LessonSkeleton } from './planner/schema.js'
import { writeLesson } from './writer/write-lesson.js'

async function main() {
  const skeletonsDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-skeletons')
  const lessonsDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-lessons')
  mkdirSync(lessonsDir, { recursive: true })

  // Only pick the "final" skeletons (no v1/v2/v3 versioned ones).
  const files = readdirSync(skeletonsDir).filter((f) => f.endsWith('.json') && !f.match(/\.v\d+\.json$/))
  if (files.length === 0) {
    console.error('No skeletons found. Run run-pipeline.ts first.')
    process.exit(1)
  }

  for (const file of files) {
    const path = resolve(skeletonsDir, file)
    const skeleton = JSON.parse(readFileSync(path, 'utf8')) as LessonSkeleton

    console.log('')
    console.log(`━━━ Writing: ${skeleton.lessonName} ━━━`)
    const start = Date.now()
    try {
      const result = await writeLesson(skeleton)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)

      const outPath = resolve(lessonsDir, file.replace(/\.json$/, '.txt'))
      writeFileSync(outPath, result.text, 'utf8')

      const status = result.parseOk
        ? result.structureWarnings.length === 0
          ? '✅ PARSE-OK + CLEAN'
          : `⚠️  PARSE-OK + ${result.structureWarnings.length} warnings`
        : '❌ PARSE-FAILED'
      console.log(`${status} in ${elapsed}s → ${outPath.replace(process.cwd(), '.')}`)
      console.log(`  Output size: ${result.text.length} chars`)
      if (!result.parseOk) console.log(`  Parse error: ${result.parseError}`)
      for (const w of result.structureWarnings) console.log(`  ⚠️  ${w}`)
    } catch (err) {
      console.error(`✗ FAILED: ${err instanceof Error ? err.message : err}`)
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
