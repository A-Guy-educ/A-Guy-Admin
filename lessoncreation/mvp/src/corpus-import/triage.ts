/**
 * Triage stage — decide whether to REPAIR an existing corpus lesson or
 * REGENERATE it from scratch.
 *
 * The 170-lesson corpus was produced by an earlier, weaker pipeline. Some
 * of those lessons are still salvageable via reader-critic + auto-patch
 * (content-level bug fixes). Others have structural or pedagogical
 * problems the repair path can't touch — for those, regenerating from
 * scratch using our full 6-stage pipeline is faster and produces better
 * output.
 *
 * The gate: run structural + pedagogical critics on the reverse-planned
 * skeleton. If either finds heavy issues (many CRITICAL/HIGH), the
 * skeleton itself is bad → regenerate. Otherwise the skeleton is workable
 * → repair the content in place.
 *
 * Threshold is conservative — we lean toward regenerating on the fence
 * because regeneration produces cleaner output on our own generations
 * (~90% clean baseline) whereas repair on a bad-skeleton lesson often
 * introduces plan-fidelity noise.
 */
import { critiqueSkeleton } from '../critic/critique-skeleton.js'
import { critiquePedagogically } from '../critic/pedagogical-critic.js'
import type { CriticVerdict } from '../critic/schema.js'
import type { LessonSkeleton } from '../planner/schema.js'

export type TriageAction = 'REPAIR' | 'REGENERATE'

export interface TriageDecision {
  action: TriageAction
  reason: string
  structural: CriticVerdict
  pedagogical: CriticVerdict
  /** Counts across both critics — used for the threshold check. */
  counts: {
    crit: number
    high: number
    med: number
    low: number
  }
}

/**
 * Thresholds — any CRITICAL or ≥3 combined HIGH triggers REGENERATE.
 *
 * Rationale: a reverse-planned skeleton with a CRITICAL finding usually
 * means the source content itself is fundamentally broken (missing
 * exercises, contradictory objectives, ungenerated sections). No amount
 * of content-level patching will fix that. HIGH findings on the skeleton
 * indicate the pedagogical progression is off — repair can't fix that
 * either, only regeneration can.
 *
 * Medium and Low findings on the skeleton are typically minor and
 * repair-tolerable.
 */
const REGEN_CRIT_THRESHOLD = 1
const REGEN_HIGH_THRESHOLD = 3

function countBySeverity(v: CriticVerdict) {
  const c = { crit: 0, high: 0, med: 0, low: 0 }
  for (const f of v.findings) {
    if (f.severity === 'CRITICAL') c.crit++
    else if (f.severity === 'HIGH') c.high++
    else if (f.severity === 'MEDIUM') c.med++
    else c.low++
  }
  return c
}

export async function triageSkeleton(skeleton: LessonSkeleton): Promise<TriageDecision> {
  const [structural, pedagogical] = await Promise.all([
    critiqueSkeleton(skeleton),
    critiquePedagogically(skeleton),
  ])
  const s = countBySeverity(structural)
  const p = countBySeverity(pedagogical)
  const counts = {
    crit: s.crit + p.crit,
    high: s.high + p.high,
    med: s.med + p.med,
    low: s.low + p.low,
  }

  if (counts.crit >= REGEN_CRIT_THRESHOLD) {
    return {
      action: 'REGENERATE',
      reason: `${counts.crit} CRITICAL finding(s) on the reverse-planned skeleton — content is fundamentally off, regenerating from scratch.`,
      structural,
      pedagogical,
      counts,
    }
  }
  if (counts.high >= REGEN_HIGH_THRESHOLD) {
    return {
      action: 'REGENERATE',
      reason: `${counts.high} HIGH findings on the reverse-planned skeleton (threshold: ${REGEN_HIGH_THRESHOLD}) — pedagogical progression is off, regenerating.`,
      structural,
      pedagogical,
      counts,
    }
  }
  return {
    action: 'REPAIR',
    reason: `Skeleton has ${counts.crit} CRITICAL / ${counts.high} HIGH / ${counts.med} MEDIUM / ${counts.low} LOW findings — within repair threshold. Auto-patching content-level issues.`,
    structural,
    pedagogical,
    counts,
  }
}
