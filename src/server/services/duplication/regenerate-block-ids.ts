/**
 * @fileType utility
 * @domain duplication
 * @pattern content-transform
 * @ai-summary Regenerate every per-doc id inside a section/exercise's `content.blocks`
 *
 * Shared by two duplicate paths:
 *   - `src/server/payload/endpoints/studio/duplicate-section.ts` — studio Duplicate Section button
 *   - `src/server/services/duplication/clone-sections-for-exercises.ts` — Duplicate Exercise + Duplicate Course
 *
 * The block factory (`src/server/payload/collections/Exercises/defaults.ts`)
 * generates fresh per-doc ids at construction time. Cloning a section by
 * spreading its source verbatim would carry the source's ids into the copy,
 * violating the "keys on block id assume per-lesson uniqueness" invariant
 * that per-block progress, analytics, and media joins rely on.
 *
 * Regenerates:
 *   - top-level `block.id` (all block types)
 *   - `question_multi_axis.graphs[].id`
 *   - `question_select` mcq `answer.options[].id` (+ rewrites `correctOptionIds`)
 *   - `question_matching` `leftColumn[].id` / `rightColumn[].id` (+ rewrites `correctPairs`)
 *   - `svg.hotspots[].id` (+ rewrites `correctHotspotIds`)
 *
 * Does NOT regenerate:
 *   - Hardcoded literal ids in the factory defaults (TF `true`/`false`,
 *     legacy `o1`/`o2`, matching `l1`/`l2`/`r1`/`r2`, hotspot literals) —
 *     these were never per-doc-unique in prod to begin with.
 *   - Admin-added `question_axis.axis.elements.graphs[].id` nested inside
 *     spec objects. Nested graph ids are only referenced from within the
 *     same block, so cross-block collision is impossible.
 */
import { generateId } from '@/server/payload/collections/Exercises/defaults'

/**
 * Return a new content object with every per-doc id regenerated. Input is
 * treated as immutable — nested objects are cloned before mutation. Safe to
 * call on `undefined`/`null` content (returns as-is).
 */
export function regenerateBlockIds(content: unknown): unknown {
  if (!content || typeof content !== 'object') return content
  const source = content as { blocks?: unknown }
  if (!Array.isArray(source.blocks)) return content

  const newBlocks = source.blocks.map((block) => {
    if (!block || typeof block !== 'object') return block
    const cloned: Record<string, unknown> = {
      ...(block as Record<string, unknown>),
      id: generateId(),
    }
    remapNestedIds(cloned)
    return cloned
  })

  return { ...source, blocks: newBlocks }
}

function remapNestedIds(block: Record<string, unknown>): void {
  if (block.type === 'question_multi_axis' && Array.isArray(block.graphs)) {
    block.graphs = (block.graphs as Record<string, unknown>[]).map((g) => ({
      ...g,
      id: generateId(),
    }))
  }

  if (
    block.type === 'question_select' &&
    block.variant === 'mcq' &&
    block.answer &&
    typeof block.answer === 'object'
  ) {
    const answer = block.answer as {
      options?: Array<Record<string, unknown>>
      correctOptionIds?: string[]
    }
    if (Array.isArray(answer.options)) {
      const idMap: Record<string, string> = {}
      const nextOptions = answer.options.map((opt) => {
        const oldId = typeof opt.id === 'string' ? opt.id : null
        const newId = generateId()
        if (oldId) idMap[oldId] = newId
        return { ...opt, id: newId }
      })
      block.answer = {
        ...answer,
        options: nextOptions,
        correctOptionIds: Array.isArray(answer.correctOptionIds)
          ? answer.correctOptionIds.map((id) => idMap[id] ?? id)
          : answer.correctOptionIds,
      }
    }
  }

  if (block.type === 'question_matching') {
    const leftMap: Record<string, string> = {}
    const rightMap: Record<string, string> = {}
    if (Array.isArray(block.leftColumn)) {
      block.leftColumn = (block.leftColumn as Record<string, unknown>[]).map((item) => {
        const oldId = typeof item.id === 'string' ? item.id : null
        const newId = generateId()
        if (oldId) leftMap[oldId] = newId
        return { ...item, id: newId }
      })
    }
    if (Array.isArray(block.rightColumn)) {
      block.rightColumn = (block.rightColumn as Record<string, unknown>[]).map((item) => {
        const oldId = typeof item.id === 'string' ? item.id : null
        const newId = generateId()
        if (oldId) rightMap[oldId] = newId
        return { ...item, id: newId }
      })
    }
    if (Array.isArray(block.correctPairs)) {
      block.correctPairs = (block.correctPairs as Array<Record<string, unknown>>).map((pair) => ({
        ...pair,
        optionId:
          typeof pair.optionId === 'string'
            ? (leftMap[pair.optionId] ?? pair.optionId)
            : pair.optionId,
        matchId:
          typeof pair.matchId === 'string'
            ? (rightMap[pair.matchId] ?? pair.matchId)
            : pair.matchId,
      }))
    }
  }

  if (block.type === 'svg' && Array.isArray(block.hotspots)) {
    const idMap: Record<string, string> = {}
    block.hotspots = (block.hotspots as Record<string, unknown>[]).map((h) => {
      const oldId = typeof h.id === 'string' ? h.id : null
      const newId = generateId()
      if (oldId) idMap[oldId] = newId
      return { ...h, id: newId }
    })
    if (Array.isArray(block.correctHotspotIds)) {
      block.correctHotspotIds = (block.correctHotspotIds as string[]).map((id) => idMap[id] ?? id)
    }
  }
}
