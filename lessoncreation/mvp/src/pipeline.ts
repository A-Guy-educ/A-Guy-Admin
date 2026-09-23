/**
 * Orchestrator: Planner → Critic → (Reviser → Critic)* → done.
 *
 * Loop rules:
 *   - Max 3 critic iterations (initial + up to 2 revision rounds).
 *   - Exit early when critic returns passed=true.
 *   - On max iterations without pass, return the best skeleton produced
 *     and a "halt" flag — human decides.
 *
 * Persists every intermediate artifact so we can trace what happened for
 * each lesson. Batch runs write to:
 *   generated-skeletons/<lesson>.json           (final skeleton)
 *   generated-skeletons/<lesson>.v1.json        (first draft)
 *   generated-skeletons/<lesson>.v2.json        (after first revision, if any)
 *   generated-verdicts/<lesson>.iter{N}.json    (each critic call)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { critiqueSkeleton } from './critic/critique-skeleton.js'
import { critiquePedagogically } from './critic/pedagogical-critic.js'
import type { CriticVerdict } from './critic/schema.js'
import { planLesson } from './planner/plan-lesson.js'
import type { LessonSkeleton } from './planner/schema.js'
import type { GenerationInput } from './planner/types.js'
import { readCritic, type ReaderCriticResult } from './reader-critic/read-critic.js'
import { spliceExercises } from './reader-critic/splice.js'
import { reviseSkeleton } from './reviser/revise-skeleton.js'
import { writeLesson } from './writer/write-lesson.js'

export type PipelineOutcome = 'PASS_CLEAN' | 'PASS_WITH_NOTES' | 'HALT'

export interface PipelineResult {
  input: GenerationInput
  finalSkeleton: LessonSkeleton
  iterations: Array<{
    iterationNumber: number
    verdict: CriticVerdict
    patchedNumbers: number[]
  }>
  outcome: PipelineOutcome
  /** The v2 `.txt` output from the writer stage. Present iff writer succeeded. */
  lessonText?: string
  writerParseOk?: boolean
  writerStructureWarnings?: string[]
  writerParseError?: string
  writerSketchCount?: number
  writerSketchSucceeded?: number
  writerSketchFailed?: number
  /**
   * Reader-critic loop results — one entry per iteration. Present when the
   * reader critic ran (i.e., writer produced parseable text).
   */
  readerCriticIterations?: Array<{
    iterationNumber: number
    result: ReaderCriticResult
    patchedNumbers: number[]
  }>
  totalDurationMs: number
}

const MAX_ITERATIONS = 3

/**
 * Pipeline exit rule (separate from the critic's own `passed` flag, which
 * stays strict as an honest signal). We accept a skeleton when:
 *   - 0 CRITICAL findings AND
 *   - ≤1 HIGH findings
 * MEDIUM/LOW findings are always writer notes, never blockers.
 * A single HIGH is a "writer note" — the boss's 70-80% target explicitly
 * tolerates minor edits, and 1 HIGH is exactly that.
 */
function outcomeFor(verdict: CriticVerdict): PipelineOutcome | null {
  const critical = verdict.findings.filter((f) => f.severity === 'CRITICAL').length
  const high = verdict.findings.filter((f) => f.severity === 'HIGH').length
  if (critical === 0 && high === 0) return 'PASS_CLEAN'
  if (critical === 0 && high <= 1) return 'PASS_WITH_NOTES'
  return null // Not acceptable yet — keep iterating.
}

function safeName(hebrew: string): string {
  return hebrew.replace(/[^\w֐-׿א-ת]+/g, '-')
}

export interface RunPipelineOptions {
  /** Write per-lesson artifacts to disk. Defaults to true. */
  persistArtifacts?: boolean
  /** Base directory for artifacts. Defaults to `lessoncreation/mvp/`. */
  outputBaseDir?: string
}

export async function runPipeline(
  input: GenerationInput,
  options: RunPipelineOptions = {},
): Promise<PipelineResult> {
  const persist = options.persistArtifacts !== false
  const baseDir = options.outputBaseDir ?? resolve(process.cwd(), 'lessoncreation', 'mvp')
  const skeletonsDir = resolve(baseDir, 'generated-skeletons')
  const verdictsDir = resolve(baseDir, 'generated-verdicts')
  if (persist) {
    mkdirSync(skeletonsDir, { recursive: true })
    mkdirSync(verdictsDir, { recursive: true })
  }
  const stem = safeName(input.lessonName)
  const writeArtifact = (file: string, content: unknown) => {
    if (!persist) return
    writeFileSync(file, JSON.stringify(content, null, 2), 'utf8')
  }

  const t0 = Date.now()

  console.log('')
  console.log(`━━━ [Planner] ${input.lessonName} ━━━`)
  let skeleton = await planLesson(input)
  writeArtifact(resolve(skeletonsDir, `${stem}.v1.json`), skeleton)

  const iterations: PipelineResult['iterations'] = []
  let finalOutcome: PipelineOutcome = 'HALT'

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`━━━ [Critic iter ${iter}] ${input.lessonName} — structural + pedagogical (parallel) ━━━`)
    // Two critics run in parallel: structural (rule-based) + pedagogical
    // (teacher-role, no rules). Same schema, so findings combine into
    // a single list that the reviser handles uniformly.
    const [structuralVerdict, pedagogicalVerdict] = await Promise.all([
      critiqueSkeleton(skeleton),
      critiquePedagogically(skeleton),
    ])
    const verdict: CriticVerdict = {
      passed: structuralVerdict.passed && pedagogicalVerdict.passed,
      overallVerdict:
        !structuralVerdict.passed || !pedagogicalVerdict.passed
          ? 'FAIL'
          : structuralVerdict.findings.length > 0 || pedagogicalVerdict.findings.length > 0
            ? 'PASS_WITH_FIXES'
            : 'PASS',
      summary: `[Structural] ${structuralVerdict.summary}\n[Pedagogical] ${pedagogicalVerdict.summary}`,
      findings: [...structuralVerdict.findings, ...pedagogicalVerdict.findings],
    }
    const crit = verdict.findings.filter((f) => f.severity === 'CRITICAL').length
    const high = verdict.findings.filter((f) => f.severity === 'HIGH').length
    const med = verdict.findings.filter((f) => f.severity === 'MEDIUM').length
    const low = verdict.findings.filter((f) => f.severity === 'LOW').length
    const sCrit = structuralVerdict.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length
    const pCrit = pedagogicalVerdict.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length
    console.log(
      `  → ${verdict.overallVerdict} — CRIT:${crit} HIGH:${high} MED:${med} LOW:${low} (structural: ${sCrit} blocking, pedagogical: ${pCrit} blocking)`,
    )
    writeArtifact(resolve(verdictsDir, `${stem}.iter${iter}.json`), verdict)
    writeArtifact(resolve(verdictsDir, `${stem}.iter${iter}.structural.json`), structuralVerdict)
    writeArtifact(resolve(verdictsDir, `${stem}.iter${iter}.pedagogical.json`), pedagogicalVerdict)

    const outcome = outcomeFor(verdict)
    if (outcome !== null) {
      finalOutcome = outcome
      iterations.push({ iterationNumber: iter, verdict, patchedNumbers: [] })
      break
    }

    if (iter >= MAX_ITERATIONS) {
      iterations.push({ iterationNumber: iter, verdict, patchedNumbers: [] })
      break
    }

    console.log(`━━━ [Reviser iter ${iter}] ${input.lessonName} ━━━`)
    const revision = await reviseSkeleton(skeleton, verdict)
    console.log(`  → patched exercises: [${revision.patchedNumbers.join(', ')}]`)
    skeleton = revision.skeleton
    iterations.push({
      iterationNumber: iter,
      verdict,
      patchedNumbers: revision.patchedNumbers,
    })
    writeArtifact(resolve(skeletonsDir, `${stem}.v${iter + 1}.json`), skeleton)
  }

  writeArtifact(resolve(skeletonsDir, `${stem}.json`), skeleton)

  // Stage 4: Writer — regardless of pipeline outcome, materialize the
  // final skeleton to v2 text. Even a HALT skeleton with residual notes
  // is usable — the notes go to the human reviewer.
  console.log(`━━━ [Writer] ${input.lessonName} ━━━`)
  const writeResult = await writeLesson(skeleton)
  const writerStatus = writeResult.parseOk
    ? writeResult.structureWarnings.length === 0
      ? 'PARSE-OK + CLEAN'
      : `PARSE-OK + ${writeResult.structureWarnings.length} warnings`
    : 'PARSE-FAILED'
  console.log(`  → ${writerStatus} (${writeResult.text.length} chars)`)

  let lessonText = writeResult.text
  const readerCriticIterations: NonNullable<PipelineResult['readerCriticIterations']> = []

  // Stage 6: Reader critic loop — reads the FINAL rendered lesson (post-
  // materializer) and checks per-exercise semantic coherence + plan
  // fidelity. Only runs if writer produced parseable text (otherwise
  // there's nothing coherent to read). Max 2 iterations: initial read +
  // 1 fix pass. Second read verifies the fix; a second fix pass is
  // deferred to keep costs bounded.
  const READER_MAX_ITERATIONS = 2
  if (writeResult.parseOk) {
    for (let iter = 1; iter <= READER_MAX_ITERATIONS; iter++) {
      console.log(`━━━ [Reader Critic iter ${iter}] ${input.lessonName} ━━━`)
      const readerResult = await readCritic(lessonText, skeleton)
      console.log(
        `  → flagged: ${readerResult.flaggedExerciseNumbers.length} exercises | CRIT:${readerResult.totalCritical} HIGH:${readerResult.totalHigh} MED:${readerResult.totalMedium} LOW:${readerResult.totalLow}`,
      )
      const flagged = readerResult.flaggedExerciseNumbers
      if (flagged.length === 0 || iter >= READER_MAX_ITERATIONS) {
        readerCriticIterations.push({
          iterationNumber: iter,
          result: readerResult,
          patchedNumbers: [],
        })
        break
      }

      // Build feedback map from CRITICAL/HIGH findings on flagged exercises.
      const feedbackPerExercise = new Map<number, string>()
      for (const v of readerResult.verdicts) {
        if (!flagged.includes(v.exerciseNumber)) continue
        const blocking = v.findings.filter(
          (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
        )
        if (blocking.length === 0) continue
        const lines: string[] = []
        for (const f of blocking) {
          const loc =
            f.sectionLetter === 'exercise'
              ? `כלל-תרגילי`
              : `סעיף ${f.sectionLetter}'`
          lines.push(`- [${f.severity} — ${loc}] ${f.issue} → ${f.suggestedFix}`)
        }
        feedbackPerExercise.set(v.exerciseNumber, lines.join('\n'))
      }

      // Chunk the flagged exercises so each writer call handles at most
      // MAX_PATCH_CHUNK exercises. Writing many at once with feedback
      // attached to each degrades output quality — the original run
      // wrote 10 exercises fine, but patching 7 with feedback produced
      // truncated DSL and other regressions. Chunks run in parallel
      // since they touch disjoint exercises.
      const MAX_PATCH_CHUNK = 3
      const chunks: number[][] = []
      for (let i = 0; i < flagged.length; i += MAX_PATCH_CHUNK) {
        chunks.push(flagged.slice(i, i + MAX_PATCH_CHUNK))
      }
      console.log(
        `━━━ [Writer regen iter ${iter}] patching [${flagged.join(', ')}] in ${chunks.length} parallel call${chunks.length > 1 ? 's' : ''} ━━━`,
      )
      const patchResults = await Promise.all(
        chunks.map((chunk) => {
          const chunkFeedback = new Map<number, string>()
          for (const n of chunk) {
            const fb = feedbackPerExercise.get(n)
            if (fb) chunkFeedback.set(n, fb)
          }
          return writeLesson(skeleton, {
            onlyExercises: chunk,
            feedbackPerExercise: chunkFeedback,
          })
        }),
      )

      // Splice each chunk's patches into the current lesson text.
      let spliceFailed = false
      for (let i = 0; i < chunks.length; i++) {
        try {
          lessonText = spliceExercises(lessonText, patchResults[i].text, chunks[i])
        } catch (err) {
          console.error(
            `  splice failed for chunk [${chunks[i].join(',')}]: ${err instanceof Error ? err.message : err}`,
          )
          spliceFailed = true
          break
        }
      }
      if (spliceFailed) {
        readerCriticIterations.push({
          iterationNumber: iter,
          result: readerResult,
          patchedNumbers: [],
        })
        break
      }
      readerCriticIterations.push({
        iterationNumber: iter,
        result: readerResult,
        patchedNumbers: flagged,
      })
    }
  } else {
    console.log(`  [Reader Critic] skipped — writer output not parseable`)
  }

  const lessonsDir = resolve(baseDir, 'generated-lessons')
  if (persist) {
    mkdirSync(lessonsDir, { recursive: true })
    const txtPath = resolve(lessonsDir, `${stem}.txt`)
    writeFileSync(txtPath, lessonText, 'utf8')
    // Also persist reader-critic verdicts for traceability.
    if (readerCriticIterations.length > 0) {
      for (const { iterationNumber, result } of readerCriticIterations) {
        writeFileSync(
          resolve(verdictsDir, `${stem}.reader-iter${iterationNumber}.json`),
          JSON.stringify(result, null, 2),
          'utf8',
        )
      }
    }
  }

  return {
    input,
    finalSkeleton: skeleton,
    iterations,
    outcome: finalOutcome,
    lessonText,
    writerParseOk: writeResult.parseOk,
    writerStructureWarnings: writeResult.structureWarnings,
    writerParseError: writeResult.parseError,
    writerSketchCount: writeResult.sketchCount,
    writerSketchSucceeded: writeResult.sketchSucceeded,
    writerSketchFailed: writeResult.sketchFailed,
    readerCriticIterations,
    totalDurationMs: Date.now() - t0,
  }
}
