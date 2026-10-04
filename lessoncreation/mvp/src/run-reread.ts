/**
 * Re-run reader-critic on an already-patched corpus lesson. Used when the
 * first iter-2 run hit transient Gemini failures — the patched text is on
 * disk, we just need a clean verdict.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { LessonSkeleton } from './planner/schema.js'
import { readCritic } from './reader-critic/read-critic.js'

const STEM = process.env.CORPUS_TARGET ?? 'משפט תלס'

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

async function main() {
  const baseDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'corpus-samples')
  const stem = safeName(STEM)
  const text = readFileSync(resolve(baseDir, `${stem}.patched.txt`), 'utf8')
  const skeleton = JSON.parse(
    readFileSync(resolve(baseDir, `${stem}.skeleton.json`), 'utf8'),
  ) as LessonSkeleton
  console.log(`━━━ Re-read [${STEM}] on patched text (${text.length} chars) ━━━`)
  const verdict = await readCritic(text, skeleton)
  console.log(
    `  → CRIT:${verdict.totalCritical} HIGH:${verdict.totalHigh} MED:${verdict.totalMedium} LOW:${verdict.totalLow}`,
  )
  console.log(`  Flagged: [${verdict.flaggedExerciseNumbers.join(', ') || '-'}]`)
  writeFileSync(
    resolve(baseDir, `${stem}.reader-iter2.json`),
    JSON.stringify(verdict, null, 2),
    'utf8',
  )
  console.log(`  Persisted: ${stem}.reader-iter2.json`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
