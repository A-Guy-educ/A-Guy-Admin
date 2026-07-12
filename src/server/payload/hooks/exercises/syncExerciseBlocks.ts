/**
 * @fileType utility
 * @domain exercises
 * @pattern hook-helper
 * @ai-summary Syncs an exercise's `blocks` array when sections change.
 *
 * Mirrors `syncLessonBlocks.ts`. The exercise-side `blocks` field is being
 * introduced as part of issue #166 — until the field lands in the schema, the
 * helper writes to it anyway (Payload ignores unknown fields at write time
 * for collection updates, but the JSON-encoded string is what the field will
 * expect). When the field is added, this code starts being authoritative.
 *
 * The guard `req.context._skipExerciseBlockSync` prevents infinite recursion:
 * the update inside this helper sets that flag on the nested `req.context`,
 * so the resulting afterChange hook on the same exercise is a no-op.
 *
 * The flag is intentionally distinct from `_skipBlockSync` (used by the
 * exercise→lesson sync helper) because Payload mutates `req.context` across
 * nested operations — sharing the name would let a stale flag from a prior
 * lesson sync leak into a later section sync on the same request.
 */

import type { Payload, PayloadRequest } from 'payload'

interface BlockEntry {
  id: string
  blockType: 'sectionRef'
  section?: string
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

  await payload.update({
    collection: 'exercises',
    id: exerciseId,
    data: { blocks: JSON.stringify(updated) },
    overrideAccess: true,
    req,
    context: { _skipExerciseBlockSync: true },
  })
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

  await payload.update({
    collection: 'exercises',
    id: exerciseId,
    data: { blocks: JSON.stringify(filtered) },
    overrideAccess: true,
    req,
    context: { _skipExerciseBlockSync: true },
  })
}
