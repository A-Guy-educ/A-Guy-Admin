/**
 * CLI: run the planner on N hard-coded lessons and persist each skeleton
 * to `lessoncreation/mvp/generated-skeletons/<name>.json`.
 *
 * Iteration entry point. Once we're happy with the output quality we'll
 * switch to CSV-driven batching.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { planLesson } from './planner/plan-lesson.js'
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

function safeFileName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

async function main() {
  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-skeletons')
  mkdirSync(outDir, { recursive: true })

  for (const target of TARGETS) {
    console.log('')
    console.log(`━━━ Planning: ${target.lessonName} (${target.course} / ${target.chapter}) ━━━`)
    const start = Date.now()
    try {
      const skeleton = await planLesson(target)
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      const outPath = resolve(outDir, `${safeFileName(target.lessonName)}.json`)
      writeFileSync(outPath, JSON.stringify(skeleton, null, 2), 'utf8')
      console.log(`✓ ${elapsed}s → ${outPath.replace(process.cwd(), '.')}`)
      // Compact preview so we can eyeball at the terminal without opening files.
      for (const ex of skeleton.exercises) {
        console.log(`  #${ex.number}: ${ex.objective}`)
        console.log(`     new: ${ex.oneNewThing}`)
      }
    } catch (err) {
      console.error(`✗ FAILED for "${target.lessonName}":`, err instanceof Error ? err.message : err)
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
