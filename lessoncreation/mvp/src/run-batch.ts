/**
 * CLI: run the full pipeline on a curated 10-lesson grade-10 batch.
 *
 * Three mini-units so each lesson has a real prev/next context:
 *   - Algebra (quadratic equations without functions): 4 lessons
 *   - Geometry (Pythagorean, congruent/similar triangles): 3 lessons
 *   - Trigonometry (right-triangle sin/cos/tan): 3 lessons
 *
 * After all lessons finish, writes a markdown summary to
 *   `lessoncreation/mvp/generated-batch-report.md`
 * so a human can review outcomes at a glance the next morning.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { runPipeline, type PipelineResult } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'

const BATCH: GenerationInput[] = [
  // --- Algebra: quadratic equations without functions ---
  {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'משוואות ריבועיות: מבוא',
    prevLesson: '',
    nextLesson: 'פירוק לגורמים: הוצאת גורם משותף',
    gradeLevel: '10',
    notes: 'שיעור מבוא. הצג את הצורה הכללית ax² + bx + c = 0. אל תפתור משוואות עדיין — רק זיהוי המבנה.',
  },
  {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'פירוק לגורמים: הוצאת גורם משותף',
    prevLesson: 'משוואות ריבועיות: מבוא',
    nextLesson: 'פירוק לגורמים: נוסחאות כפל מקוצר',
    gradeLevel: '10',
    notes: 'התמקד בהוצאת גורם משותף מספרי, אלגברי, וסוגריים משותפים. הימנע מהצגת פונקציה ריבועית או גרפים.',
  },
  {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'פירוק לגורמים: נוסחאות כפל מקוצר',
    prevLesson: 'פירוק לגורמים: הוצאת גורם משותף',
    nextLesson: 'פתרון משוואה ריבועית על ידי פירוק',
    gradeLevel: '10',
    notes: 'התמקד בנוסחאות a²−b², (a+b)², (a−b)². דוגמאות חזותיות של ריבועים ומלבנים לפירוקים אינטואיטיביים.',
  },
  {
    course: 'כיתה י',
    chapter: 'משוואות ריבועיות',
    lessonName: 'פתרון משוואה ריבועית על ידי פירוק',
    prevLesson: 'פירוק לגורמים: נוסחאות כפל מקוצר',
    nextLesson: '',
    gradeLevel: '10',
    notes: 'שילוב שיטות הפירוק לפתרון משוואות. שים דגש על "מכפלה = 0 ⇒ אחד הגורמים = 0". אל תיגע בפונקציה ריבועית או פרבולה.',
  },

  // --- Geometry ---
  {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משפט פיתגורס: יישומים',
    prevLesson: '',
    nextLesson: 'משולשים חופפים',
    gradeLevel: '10',
    notes: 'שיעור יישום של פיתגורס במצבים שונים (סולם על קיר, אלכסון של מלבן, מרחקים). השתמש ב-DSL הגיאומטרי המלא.',
  },
  {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משולשים חופפים',
    prevLesson: 'משפט פיתגורס: יישומים',
    nextLesson: 'משולשים דומים',
    gradeLevel: '10',
    notes: 'משפטי חפיפה: צלע-זווית-צלע, זווית-צלע-זווית, צלע-צלע-צלע. השתמש בשרטוטי DSL עם זוויות מסומנות ותוויות צלעות.',
  },
  {
    course: 'כיתה י',
    chapter: 'גיאומטריה',
    lessonName: 'משולשים דומים',
    prevLesson: 'משולשים חופפים',
    nextLesson: '',
    gradeLevel: '10',
    notes: 'משפטי דמיון + יחסי צלעות. הראה משולשים עם צלעות מסומנות בערכים מספריים ואת יחסי הדמיון.',
  },

  // --- Trigonometry in right triangles ---
  {
    course: 'כיתה י',
    chapter: 'טריגונומטריה במשולש ישר-זווית',
    lessonName: 'הגדרת סינוס, קוסינוס וטנגנס',
    prevLesson: 'משולשים דומים',
    nextLesson: 'חישוב צלעות במשולש ישר-זווית',
    gradeLevel: '10',
    notes: 'הצג את שלוש הפונקציות ביחסי צלעות במשולש ישר-זווית בלבד. שרטוטי משולש ישר-זווית עם זווית α, צלע נגדית, צלע סמוכה ויתר. אל תיגע במעגל היחידה או בגרפים.',
  },
  {
    course: 'כיתה י',
    chapter: 'טריגונומטריה במשולש ישר-זווית',
    lessonName: 'חישוב צלעות במשולש ישר-זווית',
    prevLesson: 'הגדרת סינוס, קוסינוס וטנגנס',
    nextLesson: 'חישוב זוויות במשולש ישר-זווית',
    gradeLevel: '10',
    notes: 'תרגילים של חישוב צלע חסרה כאשר נתונות זווית וצלע אחת. השתמש בערכי טריגו של 30°, 45°, 60° לתרגילים אינטואיטיביים.',
  },
  {
    course: 'כיתה י',
    chapter: 'טריגונומטריה במשולש ישר-זווית',
    lessonName: 'חישוב זוויות במשולש ישר-זווית',
    prevLesson: 'חישוב צלעות במשולש ישר-זווית',
    nextLesson: '',
    gradeLevel: '10',
    notes: 'שימוש בפונקציות הפוכות (arcsin, arccos, arctan) למציאת זוויות כאשר נתונות שתי צלעות. תרגילים עם ערכים מספריים "נוחים".',
  },
]

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

interface BatchRow {
  input: GenerationInput
  result?: PipelineResult
  error?: string
}

function renderReport(rows: BatchRow[]): string {
  const total = rows.length
  const passClean = rows.filter((r) => r.result?.outcome === 'PASS_CLEAN').length
  const passNotes = rows.filter((r) => r.result?.outcome === 'PASS_WITH_NOTES').length
  const halt = rows.filter((r) => r.result?.outcome === 'HALT').length
  const errored = rows.filter((r) => r.error).length
  const writerClean = rows.filter(
    (r) => r.result?.writerParseOk && (r.result?.writerStructureWarnings?.length ?? 0) === 0,
  ).length
  const writerFailed = rows.filter((r) => r.result && !r.result.writerParseOk).length
  const totalWallMs = rows.reduce((sum, r) => sum + (r.result?.totalDurationMs ?? 0), 0)

  const lines: string[] = []
  lines.push(`# Batch report — 10-lesson grade-10 run`)
  lines.push('')
  lines.push(`**Total wall time:** ${(totalWallMs / 1000 / 60).toFixed(1)} minutes`)
  lines.push('')
  lines.push(`## Summary`)
  lines.push('')
  lines.push(`| Outcome | Count |`)
  lines.push(`|---|---|`)
  lines.push(`| ✅ PASS-CLEAN (0 findings) | ${passClean}/${total} |`)
  lines.push(`| ☑️ PASS-WITH-NOTES (≤1 HIGH) | ${passNotes}/${total} |`)
  lines.push(`| ⚠️ HALT (>1 HIGH after 3 iterations) | ${halt}/${total} |`)
  lines.push(`| ❌ Pipeline errored | ${errored}/${total} |`)
  lines.push(`| Writer parse-clean output | ${writerClean}/${total} |`)
  lines.push(`| Writer parse-failed output | ${writerFailed}/${total} |`)
  lines.push('')
  lines.push(`## Per-lesson breakdown`)
  lines.push('')
  for (const row of rows) {
    const stem = safeName(row.input.lessonName)
    lines.push(`### ${row.input.lessonName}`)
    lines.push(`- **Chapter:** ${row.input.chapter}`)
    lines.push(`- **Prev / Next:** ${row.input.prevLesson || '(none)'} → ${row.input.nextLesson || '(none)'}`)
    if (row.error) {
      lines.push(`- **Outcome:** ❌ ERRORED — ${row.error}`)
      lines.push('')
      continue
    }
    if (!row.result) continue
    lines.push(`- **Outcome:** ${row.result.outcome} in ${row.result.iterations.length} iter, ${(row.result.totalDurationMs / 1000).toFixed(1)}s`)
    lines.push(
      `- **Writer:** ${row.result.writerParseOk ? '✅ parses' : '❌ FAILED'}` +
        `${(row.result.writerStructureWarnings?.length ?? 0) > 0 ? ` (${row.result.writerStructureWarnings?.length} warnings)` : ''}`,
    )
    for (const iter of row.result.iterations) {
      const crit = iter.verdict.findings.filter((f) => f.severity === 'CRITICAL').length
      const high = iter.verdict.findings.filter((f) => f.severity === 'HIGH').length
      const med = iter.verdict.findings.filter((f) => f.severity === 'MEDIUM').length
      const patched = iter.patchedNumbers.length
        ? `patched [${iter.patchedNumbers.join(',')}]`
        : 'no patches'
      lines.push(`  - iter ${iter.iterationNumber}: CRIT:${crit} HIGH:${high} MED:${med} → ${patched}`)
    }
    // If the final iteration still has residual findings, surface them so
    // human reviewers can decide what to hand-fix in the .txt.
    const finalIter = row.result.iterations[row.result.iterations.length - 1]
    if (finalIter && finalIter.verdict.findings.length > 0) {
      lines.push(`  - **Residual notes for human reviewer:**`)
      for (const f of finalIter.verdict.findings.slice(0, 5)) {
        const loc = f.exerciseNumber === 0 ? 'lesson-level' : `E${f.exerciseNumber}`
        lines.push(`    - [${f.severity}] ${loc} (${f.rule}): ${f.issue}`)
      }
      if (finalIter.verdict.findings.length > 5) {
        lines.push(`    - _...and ${finalIter.verdict.findings.length - 5} more_`)
      }
    }
    lines.push(`- **Artifacts:**`)
    lines.push(`  - Skeleton: \`generated-skeletons/${stem}.json\``)
    lines.push(`  - Lesson text: \`generated-lessons/${stem}.txt\``)
    lines.push(`  - Verdict trace: \`generated-verdicts/${stem}.iter*.json\``)
    lines.push('')
  }
  return lines.join('\n')
}

async function main() {
  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp')
  mkdirSync(outDir, { recursive: true })

  const rows: BatchRow[] = []
  const t0 = Date.now()

  for (let i = 0; i < BATCH.length; i++) {
    const target = BATCH[i]
    console.log('')
    console.log(`╔══════════════════════════════════════════════════`)
    console.log(`║ [${i + 1}/${BATCH.length}] ${target.lessonName}`)
    console.log(`╚══════════════════════════════════════════════════`)
    try {
      const result = await runPipeline(target)
      rows.push({ input: target, result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`✗ FAILED: ${msg}`)
      rows.push({ input: target, error: msg })
    }
  }

  const totalMinutes = ((Date.now() - t0) / 1000 / 60).toFixed(1)

  // Write the batch report.
  const report = renderReport(rows)
  const reportPath = resolve(outDir, 'generated-batch-report.md')
  writeFileSync(reportPath, report, 'utf8')

  // Terminal summary.
  console.log('')
  console.log('═══════════════ BATCH DONE ═══════════════')
  console.log('')
  for (const row of rows) {
    if (row.error) {
      console.log(`❌ ${row.input.lessonName}: ${row.error}`)
      continue
    }
    if (!row.result) continue
    const outcome =
      row.result.outcome === 'PASS_CLEAN'
        ? '✅ CLEAN'
        : row.result.outcome === 'PASS_WITH_NOTES'
          ? '☑️  NOTES'
          : '⚠️  HALT'
    const writer = row.result.writerParseOk ? 'WRITE-OK' : 'WRITE-FAIL'
    const secs = (row.result.totalDurationMs / 1000).toFixed(0)
    console.log(`${outcome} | ${writer} | ${secs}s — ${row.input.lessonName}`)
  }
  console.log('')
  console.log(`Total time: ${totalMinutes} min`)
  console.log(`Full report: ${reportPath.replace(process.cwd(), '.')}`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
