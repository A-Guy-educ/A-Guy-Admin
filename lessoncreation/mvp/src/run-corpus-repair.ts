/**
 * Triage-and-repair pipeline for a single boss-corpus lesson.
 *
 * Given a format-B `.txt` file + metadata:
 *   1. Convert (per-exercise) + reverse-plan skeleton
 *   2. TRIAGE the skeleton — structural + pedagogical critics run in parallel
 *   3. Branch:
 *      - REPAIR path: reader-critic + auto-patch flagged exercises (cheap,
 *        preserves content)
 *      - REGENERATE path: full 6-stage pipeline seeded with the reverse-plan's
 *        course/chapter/lessonName (produces fresh content from scratch)
 *   4. emit-boss-format either way
 *   5. Persist artifacts + triage decision report
 *
 * Env vars:
 *   CORPUS_PATH        = absolute path to format-B .txt   (required)
 *   CORPUS_NAME        = lesson name (default: derived from filename)
 *   CORPUS_COURSE      = course label  (default: "כיתה ח")
 *   CORPUS_CHAPTER     = chapter label (default: "אלגברה")
 *   FORCE_ACTION       = "REPAIR" or "REGENERATE" to override triage (optional)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { emitBossFormat } from './boss-format/emit.js'
import { convertAndPlan } from './corpus-import/convert-and-plan.js'
import { triageSkeleton, type TriageDecision } from './corpus-import/triage.js'
import { runPipeline } from './pipeline.js'
import type { GenerationInput } from './planner/types.js'
import {
  extractExerciseText,
  readCritic,
  type ReaderCriticResult,
} from './reader-critic/read-critic.js'
import { spliceExercises } from './reader-critic/splice.js'
import { writeLesson } from './writer/write-lesson.js'

const CORPUS_PATH = process.env.CORPUS_PATH
if (!CORPUS_PATH) throw new Error('CORPUS_PATH is required (absolute path to format-B .txt)')

const filename = basename(CORPUS_PATH, '.txt')
const derivedName = filename
  .replace(/^כיתה[_ ]ח[_ -]*/, '')
  .replace(/^שיעור[_ ]?מספר[_ ]/, 'שיעור ')
  .replace(/^שיעור[_ ]/, 'שיעור ')
  .replace(/[_]+/g, ' ')
  .trim()

const CORPUS_NAME = process.env.CORPUS_NAME ?? derivedName
const CORPUS_COURSE = process.env.CORPUS_COURSE ?? 'כיתה ח'
const CORPUS_CHAPTER = process.env.CORPUS_CHAPTER ?? 'אלגברה'
const FORCE_ACTION = process.env.FORCE_ACTION as 'REPAIR' | 'REGENERATE' | undefined
const TRIAGE_ONLY = process.env.TRIAGE_ONLY === '1'

const MAX_PATCH_CHUNK = 3

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

function statsFrom(r: ReaderCriticResult) {
  return {
    crit: r.totalCritical,
    high: r.totalHigh,
    med: r.totalMedium,
    low: r.totalLow,
    flagged: r.flaggedExerciseNumbers.length,
  }
}

interface RepairOutcome {
  action: 'REPAIR'
  before: ReaderCriticResult
  after: ReaderCriticResult
  patched: number[]
  finalText: string
}

interface RegenerateOutcome {
  action: 'REGENERATE'
  finalText: string
}

async function repairPath(
  convertedSkeleton: import('./planner/schema.js').LessonSkeleton,
  v2Text: string,
  outDir: string,
  stem: string,
): Promise<RepairOutcome> {
  console.log(`━━━ [Reader Critic iter 1] ${CORPUS_NAME} ━━━`)
  const before = await readCritic(v2Text, convertedSkeleton)
  console.log(
    `  → CRIT:${before.totalCritical} HIGH:${before.totalHigh} MED:${before.totalMedium} LOW:${before.totalLow} | flagged: [${before.flaggedExerciseNumbers.join(', ') || '-'}]`,
  )
  writeFileSync(
    resolve(outDir, `${stem}.reader-verdict.json`),
    JSON.stringify(before, null, 2),
    'utf8',
  )

  const flagged = before.flaggedExerciseNumbers
  let patchedText = v2Text
  const patchedSuccessfully: number[] = []
  let after: ReaderCriticResult = before

  if (flagged.length > 0) {
    const feedbackPerExercise = new Map<number, string>()
    for (const v of before.verdicts) {
      if (!flagged.includes(v.exerciseNumber)) continue
      const blocking = v.findings.filter(
        (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
      )
      if (blocking.length === 0) continue
      const lines: string[] = []
      for (const f of blocking) {
        const loc = f.sectionLetter === 'exercise' ? 'כלל-תרגילי' : `סעיף ${f.sectionLetter}'`
        lines.push(`- [${f.severity} — ${loc}, ${f.kind}] ${f.issue} → ${f.suggestedFix}`)
      }
      feedbackPerExercise.set(v.exerciseNumber, lines.join('\n'))
    }

    const chunks: number[][] = []
    for (let i = 0; i < flagged.length; i += MAX_PATCH_CHUNK) {
      chunks.push(flagged.slice(i, i + MAX_PATCH_CHUNK))
    }

    console.log(
      `━━━ [Writer regen] patching [${flagged.join(', ')}] in ${chunks.length} parallel call${chunks.length > 1 ? 's' : ''} ━━━`,
    )
    const results = await Promise.all(
      chunks.map((chunk) => {
        const chunkFeedback = new Map<number, string>()
        const chunkPrevious = new Map<number, string>()
        for (const n of chunk) {
          const fb = feedbackPerExercise.get(n)
          if (fb) chunkFeedback.set(n, fb)
          const prev = extractExerciseText(patchedText, n)
          if (prev) chunkPrevious.set(n, prev)
        }
        return writeLesson(convertedSkeleton, {
          onlyExercises: chunk,
          feedbackPerExercise: chunkFeedback,
          previousTextPerExercise: chunkPrevious,
        })
      }),
    )

    for (let i = 0; i < chunks.length; i++) {
      try {
        patchedText = spliceExercises(patchedText, results[i].text, chunks[i])
        patchedSuccessfully.push(...chunks[i])
      } catch (err) {
        console.error(
          `  splice failed for chunk [${chunks[i].join(',')}]: ${err instanceof Error ? err.message : err}`,
        )
      }
    }
    writeFileSync(resolve(outDir, `${stem}.patched.txt`), patchedText, 'utf8')

    console.log(`━━━ [Reader Critic iter 2] ${CORPUS_NAME} ━━━`)
    after = await readCritic(patchedText, convertedSkeleton)
    console.log(
      `  → CRIT:${after.totalCritical} HIGH:${after.totalHigh} MED:${after.totalMedium} LOW:${after.totalLow} | still flagged: [${after.flaggedExerciseNumbers.join(', ') || '-'}]`,
    )
    writeFileSync(
      resolve(outDir, `${stem}.reader-iter2.json`),
      JSON.stringify(after, null, 2),
      'utf8',
    )
  } else {
    console.log('  no flagged exercises — skipping auto-patch')
  }

  return {
    action: 'REPAIR',
    before,
    after,
    patched: patchedSuccessfully,
    finalText: patchedText,
  }
}

async function regeneratePath(
  input: GenerationInput,
  outDir: string,
  stem: string,
): Promise<RegenerateOutcome> {
  console.log(`━━━ [Regenerate — full pipeline] ${CORPUS_NAME} ━━━`)
  const result = await runPipeline(input, {
    persistArtifacts: false, // we handle persistence ourselves via `stem`
    outputBaseDir: resolve(outDir, '..'),
  })
  const text = result.lessonText ?? ''
  writeFileSync(resolve(outDir, `${stem}.regenerated.txt`), text, 'utf8')
  console.log(
    `  → outcome: ${result.outcome} | writer parse ok: ${result.writerParseOk} | ${result.lessonText?.length ?? 0} chars`,
  )
  return { action: 'REGENERATE', finalText: text }
}

async function main() {
  const outDir = resolve(process.cwd(), 'lessoncreation', 'mvp', 'corpus-samples')
  mkdirSync(outDir, { recursive: true })
  const stem = safeName(CORPUS_NAME)
  const t0 = Date.now()

  console.log('')
  console.log(`╔═══════════════════════════════════════════════`)
  console.log(`║ TRIAGE + REPAIR: ${CORPUS_NAME}`)
  console.log(`╚═══════════════════════════════════════════════`)
  console.log(`  Source: ${basename(CORPUS_PATH!)}`)
  console.log(`  Course/Chapter: ${CORPUS_COURSE} / ${CORPUS_CHAPTER}`)

  const formatBText = readFileSync(CORPUS_PATH!, 'utf8')
  console.log(`  Format-B: ${formatBText.length} chars, ${formatBText.split(/\r?\n/).length} lines`)

  console.log(`━━━ [Convert + Reverse-plan] ${CORPUS_NAME} ━━━`)
  const converted = await convertAndPlan({
    lessonName: CORPUS_NAME,
    course: CORPUS_COURSE,
    chapter: CORPUS_CHAPTER,
    formatBText,
  })
  console.log(
    `  → v2 output: ${converted.v2Text.length} chars | skeleton: ${converted.skeleton.exercises.length} exercises`,
  )
  writeFileSync(resolve(outDir, `${stem}.formatA.txt`), converted.v2Text, 'utf8')
  writeFileSync(
    resolve(outDir, `${stem}.skeleton.json`),
    JSON.stringify(converted.skeleton, null, 2),
    'utf8',
  )

  console.log(`━━━ [Triage] ${CORPUS_NAME} — structural + pedagogical critics on reverse-planned skeleton ━━━`)
  const triage: TriageDecision = await triageSkeleton(converted.skeleton)
  console.log(
    `  → decision: ${triage.action} | CRIT:${triage.counts.crit} HIGH:${triage.counts.high} MED:${triage.counts.med} LOW:${triage.counts.low}`,
  )
  console.log(`  → reason: ${triage.reason}`)
  writeFileSync(
    resolve(outDir, `${stem}.triage.json`),
    JSON.stringify(
      {
        action: triage.action,
        reason: triage.reason,
        counts: triage.counts,
        structural: triage.structural,
        pedagogical: triage.pedagogical,
      },
      null,
      2,
    ),
    'utf8',
  )

  const effectiveAction = FORCE_ACTION ?? triage.action
  if (FORCE_ACTION && FORCE_ACTION !== triage.action) {
    console.log(`  → FORCE_ACTION=${FORCE_ACTION} overrides triage decision`)
  }

  if (TRIAGE_ONLY) {
    console.log(`  → TRIAGE_ONLY=1 — stopping after triage. Would have run ${effectiveAction}.`)
    console.log('')
    console.log(`══════ TRIAGE-ONLY SUMMARY ══════`)
    console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    console.log(`Decision: ${triage.action}${FORCE_ACTION ? ` (forced: ${FORCE_ACTION})` : ''}`)
    console.log(`Skeleton counts: CRIT:${triage.counts.crit} HIGH:${triage.counts.high} MED:${triage.counts.med} LOW:${triage.counts.low}`)
    return
  }

  let outcome: RepairOutcome | RegenerateOutcome
  if (effectiveAction === 'REGENERATE') {
    outcome = await regeneratePath(
      {
        course: CORPUS_COURSE,
        chapter: CORPUS_CHAPTER,
        lessonName: CORPUS_NAME,
        prevLesson: '',
        nextLesson: '',
        gradeLevel: CORPUS_COURSE,
        notes: `Regenerated from a corpus lesson that failed triage. Original triage reason: ${triage.reason}`,
      },
      outDir,
      stem,
    )
  } else {
    outcome = await repairPath(converted.skeleton, converted.v2Text, outDir, stem)
  }

  console.log(`━━━ [Emit boss format] ${CORPUS_NAME} ━━━`)
  try {
    const bossText = emitBossFormat(outcome.finalText, converted.skeleton)
    writeFileSync(resolve(outDir, `${stem}.boss.txt`), bossText, 'utf8')
    console.log(`  → wrote ${stem}.boss.txt (${bossText.length} chars)`)
  } catch (err) {
    console.warn(`  emit failed: ${err instanceof Error ? err.message : err}`)
  }

  // Report
  const lines: string[] = []
  lines.push(`# דוח תיקון — ${CORPUS_NAME}`)
  lines.push('')
  lines.push(`- **קורס/פרק**: ${CORPUS_COURSE} / ${CORPUS_CHAPTER}`)
  lines.push(`- **מקור**: \`${basename(CORPUS_PATH!)}\``)
  lines.push(`- **זמן ריצה**: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  lines.push(`- **החלטת טריאז'**: **${triage.action}**`)
  lines.push(`- **סיבה**: ${triage.reason}`)
  if (FORCE_ACTION && FORCE_ACTION !== triage.action) {
    lines.push(`- **דריסה**: FORCE_ACTION=${FORCE_ACTION}`)
  }
  lines.push('')
  lines.push(`## ממצאי הביקורת על השלד:`)
  lines.push(`- **סטרוקטורלי**: CRIT:${triage.structural.findings.filter((f) => f.severity === 'CRITICAL').length} HIGH:${triage.structural.findings.filter((f) => f.severity === 'HIGH').length}`)
  lines.push(`- **פדגוגי**: CRIT:${triage.pedagogical.findings.filter((f) => f.severity === 'CRITICAL').length} HIGH:${triage.pedagogical.findings.filter((f) => f.severity === 'HIGH').length}`)
  lines.push('')

  if (outcome.action === 'REPAIR') {
    const bBefore = statsFrom(outcome.before)
    const bAfter = statsFrom(outcome.after)
    const bBlocking = bBefore.crit + bBefore.high
    const aBlocking = bAfter.crit + bAfter.high
    lines.push(`## מסלול תיקון (REPAIR):`)
    lines.push(`| חומרה | לפני | אחרי | שינוי |`)
    lines.push(`|---|---|---|---|`)
    lines.push(`| CRITICAL | ${bBefore.crit} | ${bAfter.crit} | ${bAfter.crit - bBefore.crit} |`)
    lines.push(`| HIGH | ${bBefore.high} | ${bAfter.high} | ${bAfter.high - bBefore.high} |`)
    lines.push(`| MEDIUM | ${bBefore.med} | ${bAfter.med} | ${bAfter.med - bBefore.med} |`)
    lines.push(`| LOW | ${bBefore.low} | ${bAfter.low} | ${bAfter.low - bBefore.low} |`)
    lines.push('')
    lines.push(
      `**Blocking findings (CRIT+HIGH)**: ${bBlocking} → ${aBlocking} (${bBlocking > 0 ? Math.round(((bBlocking - aBlocking) / bBlocking) * 100) : 0}% reduction)`,
    )
    lines.push(`**Patched**: ${outcome.patched.join(', ') || '(none)'}`)
  } else {
    lines.push(`## מסלול יצירה מחדש (REGENERATE):`)
    lines.push(`השיעור נוצר מחדש מהתחלה בעזרת הפייפליין המלא — הסקלטון המקורי לא ריפוי-בטוח.`)
  }

  writeFileSync(resolve(outDir, `${stem}.repair-report.md`), lines.join('\n'), 'utf8')

  console.log('')
  console.log(`══════ SUMMARY ══════`)
  console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log(`Action: ${outcome.action}`)
  console.log(`Files:`)
  console.log(`  ${resolve(outDir, `${stem}.formatA.txt`)}`)
  console.log(`  ${resolve(outDir, `${stem}.skeleton.json`)}`)
  console.log(`  ${resolve(outDir, `${stem}.triage.json`)}`)
  console.log(`  ${resolve(outDir, `${stem}.boss.txt`)}`)
  console.log(`  ${resolve(outDir, `${stem}.repair-report.md`)}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
