/**
 * Shared helper for the studio's create/duplicate endpoints: after the
 * afterChange hook appends a new ref to a parent's `blocks` playlist,
 * move it into the position the user asked for ("insert right after
 * <sibling ref>"). Currently used by `duplicate-section` (parent=exercise,
 * refType=sectionRef); parametrized on `parentCollection` / `blockType` /
 * `refField` so `create-section` and `create-exercise` can adopt it
 * without a rewrite.
 *
 * @fileType utility
 * @domain admin-studio
 * @ai-summary Post-insert playlist reorder — moves a just-created ref to a specific position.
 */
import type { Payload, PayloadRequest } from 'payload'

interface PlaylistEntry {
  id?: string
  blockType?: string
  section?: string
  exercise?: string
}

function parsePlaylist(raw: unknown): PlaylistEntry[] {
  // Always return a fresh array — caller mutates via splice, so returning
  // the input array directly would silently mutate whatever Payload handed
  // us (potentially a request-cache reference). Matches the codebase's
  // Immutability rule (see .claude/rules/coding-style.md).
  if (Array.isArray(raw)) return [...(raw as PlaylistEntry[])]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as PlaylistEntry[]
    } catch {
      // fall through
    }
  }
  return []
}

interface ReorderArgs {
  payload: Payload
  req: PayloadRequest
  /** Which collection the playlist lives on. */
  parentCollection: 'exercises' | 'lessons'
  parentId: string
  /** Which block type entries to reorder. */
  blockType: 'sectionRef' | 'exerciseRef'
  /** Field on the entry that holds the referenced doc id. */
  refField: 'section' | 'exercise'
  /** Ref id we just created — currently at the end of the playlist. */
  movedRefId: string
  /** Ref id the caller wants the moved entry to appear immediately after. */
  insertAfterRefId: string
}

/**
 * Move a playlist entry so it lands right after `insertAfterRefId`. No-op if
 * either ref isn't found, or if `movedRefId === insertAfterRefId`, or if the
 * entry is already in the right spot. Writes with the appropriate skip-sync
 * context flag so the parent's afterChange hook doesn't re-run the append
 * logic on us.
 */
export async function insertPlaylistRefAfter({
  payload,
  req,
  parentCollection,
  parentId,
  blockType,
  refField,
  movedRefId,
  insertAfterRefId,
}: ReorderArgs): Promise<void> {
  if (movedRefId === insertAfterRefId) return

  const parent = (await payload.findByID({
    collection: parentCollection,
    id: parentId,
    depth: 0,
    overrideAccess: true,
    req,
  })) as { blocks?: unknown }

  const entries = parsePlaylist(parent.blocks)
  const movedIdx = entries.findIndex((e) => e.blockType === blockType && e[refField] === movedRefId)
  const anchorIdx = entries.findIndex(
    (e) => e.blockType === blockType && e[refField] === insertAfterRefId,
  )
  if (movedIdx === -1 || anchorIdx === -1) return
  if (movedIdx === anchorIdx + 1) return // already in place

  const [moved] = entries.splice(movedIdx, 1)
  // splice above may have shifted the anchor index left by 1 if the moved
  // entry sat before it. Recompute so we insert at the correct offset.
  const anchorAfterSplice = entries.findIndex(
    (e) => e.blockType === blockType && e[refField] === insertAfterRefId,
  )
  entries.splice(anchorAfterSplice + 1, 0, moved)

  // Skip-sync context flag: an Exercise update fires the Exercises
  // afterChange (checks `_skipBlockSync` — would re-sync exerciseRef into
  // the parent lesson.blocks), so we set it to avoid the pointless round.
  // A Lesson update doesn't fire a similar hook in this repo (Lessons has
  // no chain-up-to-course sync), so no flag is needed for lesson writes.
  const context: Record<string, unknown> =
    parentCollection === 'exercises' ? { _skipBlockSync: true } : {}
  await payload.update({
    collection: parentCollection,
    id: parentId,
    data: { blocks: JSON.stringify(entries) } as never,
    overrideAccess: true,
    req,
    context,
  })
}
