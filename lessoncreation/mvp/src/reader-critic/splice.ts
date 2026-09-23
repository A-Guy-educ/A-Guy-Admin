/**
 * Splice helper — replaces one or more exercises in a full v2 lesson text
 * with regenerated versions. Used by the reader-critic fix loop after the
 * writer regenerates flagged exercises.
 *
 * Boundary heuristic: an exercise block starts at the `====` fence above
 * `[ תרגיל N - נתוני פתיחה ]` and ends just before the fence above the
 * next exercise header (or end of file for the last exercise).
 */
import { extractExerciseText } from './read-critic.js'

/**
 * Replace the specified exercises in `fullText` with the versions found in
 * `patchText`. Both are v2-format text — patchText may contain only the
 * flagged exercises (writer's onlyExercises mode).
 *
 * Returns the new full text with exercises spliced in.
 */
export function spliceExercises(
  fullText: string,
  patchText: string,
  exerciseNumbers: number[],
): string {
  let out = fullText
  // Process in descending order so earlier splice-indices remain valid.
  const sorted = [...exerciseNumbers].sort((a, b) => b - a)
  for (const n of sorted) {
    const patch = extractExerciseText(patchText, n)
    if (!patch) {
      throw new Error(
        `Cannot splice exercise ${n}: patchText does not contain a [ תרגיל ${n} - נתוני פתיחה ] block.`,
      )
    }
    const startRe = new RegExp(
      `\\[\\s*תרגיל\\s+${n}\\s*[-–]\\s*נתוני\\s+פתיחה\\s*\\]`,
    )
    const nextRe = new RegExp(
      `\\[\\s*תרגיל\\s+${n + 1}\\s*[-–]\\s*נתוני\\s+פתיחה\\s*\\]`,
    )
    const startMatch = startRe.exec(out)
    if (!startMatch) {
      throw new Error(`Cannot splice exercise ${n}: not found in fullText.`)
    }
    const startFence = out.lastIndexOf('=================', startMatch.index)
    const from = startFence >= 0 ? startFence : startMatch.index
    const nextMatch = nextRe.exec(out)
    let end: number
    if (nextMatch) {
      const nextFence = out.lastIndexOf('=================', nextMatch.index)
      end = nextFence >= 0 ? nextFence : nextMatch.index
    } else {
      end = out.length
    }
    // Preserve trailing whitespace before the next exercise so the file
    // stays cleanly separated.
    const before = out.slice(0, from)
    const after = out.slice(end)
    const trimmedPatch = patch.trimEnd()
    // Ensure exactly one blank line between the patch and the next block.
    const separator = after.trimStart().length > 0 ? '\n\n' : '\n'
    out = before + trimmedPatch + separator + after.trimStart()
  }
  return out
}
