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
import type { CriticVerdict } from './critic/schema.js'
import { planLesson } from './planner/plan-lesson.js'
import type { LessonSkeleton } from './planner/schema.js'
import type { GenerationInput } from './planner/types.js'
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
    console.log(`━━━ [Critic iter ${iter}] ${input.lessonName} ━━━`)
    const verdict = await critiqueSkeleton(skeleton)
    const crit = verdict.findings.filter((f) => f.severity === 'CRITICAL').length
    const high = verdict.findings.filter((f) => f.severity === 'HIGH').length
    const med = verdict.findings.filter((f) => f.severity === 'MEDIUM').length
    const low = verdict.findings.filter((f) => f.severity === 'LOW').length
    console.log(
      `  → ${verdict.overallVerdict} — CRIT:${crit} HIGH:${high} MED:${med} LOW:${low}`,
    )
    writeArtifact(resolve(verdictsDir, `${stem}.iter${iter}.json`), verdict)

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

  const lessonsDir = resolve(baseDir, 'generated-lessons')
  if (persist) {
    mkdirSync(lessonsDir, { recursive: true })
    const txtPath = resolve(lessonsDir, `${stem}.txt`)
    writeFileSync(txtPath, writeResult.text, 'utf8')
  }

  return {
    input,
    finalSkeleton: skeleton,
    iterations,
    outcome: finalOutcome,
    lessonText: writeResult.text,
    writerParseOk: writeResult.parseOk,
    writerStructureWarnings: writeResult.structureWarnings,
    writerParseError: writeResult.parseError,
    writerSketchCount: writeResult.sketchCount,
    writerSketchSucceeded: writeResult.sketchSucceeded,
    writerSketchFailed: writeResult.sketchFailed,
    totalDurationMs: Date.now() - t0,
  }
}
