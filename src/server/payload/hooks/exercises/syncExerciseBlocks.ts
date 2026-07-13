/**
 * @fileType utility
 * @domain exercises
 * @pattern hook-helper
 * @ai-summary Syncs an exercise's `blocks` array when sections change.
 *
 * Mirrors `syncLessonBlocks.ts` with two differences that matter for
 * correctness on a shared `PayloadRequest`:
 *
 * 1. The guard flag is `_skipExerciseBlockSync` (not `_skipBlockSync`) so a
 *    stale flag from an earlier exercise→lesson sync on the same request
 *    can't short-circuit a later section→exercise sync.
 * 2. The flag is restored to its prior value after `payload.update` returns.
 *    Payload's `createLocalReq` merges the passed `context` into
 *    `req.context` and does NOT restore it, so without this restore the flag
 *    would persist on the shared `adminReq` and silently skip every
 *    subsequent section create on the same request (which is what actually
 *    broke the integration tests on issue #166).
 */

import type { Payload, PayloadRequest } from 'payload'

interface BlockEntry {
  id: string
  blockType: 'sectionRef'
  section?: string
}

type MutableContext = Record<string, unknown> & { _skipExerciseBlockSync?: unknown }

/**
 * Set `_skipExerciseBlockSync` on `req.context` for the duration of the
 * update, then restore the prior value. Prevents the recursion guard from
 * leaking to unrelated operations that share this request.
 */
async function updateExerciseBlocksAndRestoreFlag(
  payload: Payload,
  req: PayloadRequest,
  exerciseId: string,
  blocksJson: string,
): Promise<void> {
  const ctx = req.context as MutableContext | undefined
  const hadFlag = ctx ? '_skipExerciseBlockSync' in ctx : false
  const previous = ctx?._skipExerciseBlockSync
  try {
    await payload.update({
      collection: 'exercises',
      id: exerciseId,
      data: { blocks: blocksJson },
      overrideAccess: true,
      req,
      context: { _skipExerciseBlockSync: true },
    })
  } finally {
    const after = req.context as MutableContext | undefined
    if (after) {
      if (hadFlag) after._skipExerciseBlockSync = previous
      else delete after._skipExerciseBlockSync
    }
  }
}

/** Parse the blocks field (JSON string or array) into a typed array. */
function parseBlocks(raw: unknown): BlockEntry[] {
  if (Array.isArray(raw)) return raw as BlockEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockEntry[]
    } catch {
      // ignore
    }
  }
  return []
}

function generateBlockId(): string {
  return Math.random().toString(36).slice(2, 14)
}

/**
 * Add a section block reference to an exercise's blocks array (appended at end).
 * No-op if a block with the same section ID already exists.
 */
export async function addBlockToExercise({
  payload,
  req,
  exerciseId,
  refId,
  blockType,
}: {
  payload: Payload
  req: PayloadRequest
  exerciseId: string
  refId: string
  blockType: 'sectionRef'
}): Promise<void> {
  const exercise = await payload.findByID({
    collection: 'exercises',
    id: exerciseId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const blocks = parseBlocks(exercise?.blocks)
  const refField = 'section'

  // Check if already present
  const exists = blocks.some((b) => b.blockType === blockType && b[refField] === refId)
  if (exists) return

  const newBlock: BlockEntry = {
    id: generateBlockId(),
    blockType,
    [refField]: refId,
  }

  const updated = [...blocks, newBlock]

  await updateExerciseBlocksAndRestoreFlag(payload, req, exerciseId, JSON.stringify(updated))
}

/**
 * Remove a section block reference from an exercise's blocks array.
 */
export async function removeBlockFromExercise({
  payload,
  req,
  exerciseId,
  refId,
  blockType,
}: {
  payload: Payload
  req: PayloadRequest
  exerciseId: string
  refId: string
  blockType: 'sectionRef'
}): Promise<void> {
  const exercise = await payload.findByID({
    collection: 'exercises',
    id: exerciseId,
    depth: 0,
    overrideAccess: true,
    req,
  })

  const blocks = parseBlocks(exercise?.blocks)
  const refField = 'section'
  const filtered = blocks.filter((b) => !(b.blockType === blockType && b[refField] === refId))

  if (filtered.length === blocks.length) return // nothing to remove

  await updateExerciseBlocksAndRestoreFlag(payload, req, exerciseId, JSON.stringify(filtered))
}
