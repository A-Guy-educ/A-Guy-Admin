/**
 * @fileType hook
 * @domain exercises
 * @pattern after-read aggregator
 * @ai-summary Read-time compatibility shim that flattens child section blocks
 * into the parent exercise's `content.blocks` for consumers that still read
 * the legacy field.
 *
 * The Admin ship and the Web ship are decoupled: the Web repo reads
 * `exercise.content.blocks` in ~6 places and does not yet know about the new
 * Sections collection. Until it does, this hook makes exercises whose
 * authors moved content into sections still look populated at read time.
 *
 * Behavior:
 * - No-op when the exercise already has its own non-empty `content.blocks`.
 * - Otherwise, query all `sections` for this exercise (depth 0, sorted by
 *   `section.order` ascending) and concatenate each section's
 *   `content.blocks` into a single in-memory array. If the parent exercise
 *   has a `blocks` playlist (the `sectionRef` sequence maintained by the
 *   Sections collection hooks), the sections are reordered to match.
 * - Best-effort: any section whose `content.blocks` is missing/invalid is
 *   silently skipped. The whole hook short-circuits during build/seed
 *   (no `req.user`) and during content-promotion imports (the bundle
 *   carries `content.blocks` verbatim and should not be reshuffled).
 * - Read-time only: nothing is persisted.
 */

import type { CollectionAfterReadHook, PayloadRequest } from 'payload'

import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'

interface SectionRefEntry {
  id?: string
  blockType?: string
  section?: string
}

function parseBlocksPlaylist(raw: unknown): SectionRefEntry[] {
  if (Array.isArray(raw)) return raw as SectionRefEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as SectionRefEntry[]
    } catch {
      // fall through
    }
  }
  return []
}

/**
 * Reorder `sections` to match the `sectionRef` sequence in `playlist`.
 * Sections not present in the playlist are appended in their original order
 * (which is `section.order` ascending from the query). Sections in the
 * playlist that are not in the query result are silently dropped.
 */
function reorderSectionsByPlaylist(
  playlist: unknown,
  sections: { id: string }[],
): { id: string }[] {
  const entries = parseBlocksPlaylist(playlist).filter(
    (e) => e.blockType === 'sectionRef' && typeof e.section === 'string' && e.section.length > 0,
  )
  if (entries.length === 0) return sections

  const byId = new Map(sections.map((s) => [s.id, s]))
  const ordered: { id: string }[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.section) continue
    const match = byId.get(entry.section)
    if (match && !seen.has(match.id)) {
      ordered.push(match)
      seen.add(match.id)
    }
  }

  for (const section of sections) {
    if (!seen.has(section.id)) {
      ordered.push(section)
    }
  }

  return ordered
}

function hasOwnBlocks(blocks: unknown): boolean {
  return Array.isArray(blocks) && blocks.length > 0
}

export const aggregateChildSectionContent: CollectionAfterReadHook = async ({ doc, req }) => {
  if (!doc) return doc
  const request = req as PayloadRequest | undefined
  if (!request?.user) return doc
  if (isContentPromotionImportRequest(request)) return doc

  const d = doc as {
    id: string
    blocks?: unknown
    content?: { blocks?: unknown }
  }

  // Legacy exercises keep their own `content.blocks`; the aggregator is
  // only relevant for exercises that have moved content into sections.
  if (hasOwnBlocks(d.content?.blocks)) return doc

  try {
    const sections = await request.payload.find({
      collection: 'sections',
      where: { exercise: { equals: d.id } },
      depth: 0,
      sort: 'order',
      limit: 1000,
      overrideAccess: true,
      req: request,
    })

    if (sections.docs.length === 0) return doc

    const ordered = reorderSectionsByPlaylist(d.blocks, sections.docs)

    const aggregated: unknown[] = []
    for (const section of ordered) {
      const sectionBlocks = (section as { content?: { blocks?: unknown } }).content?.blocks
      if (Array.isArray(sectionBlocks)) {
        for (const block of sectionBlocks) {
          aggregated.push(block)
        }
      }
      // Section with missing/invalid `content.blocks` is silently skipped.
    }

    if (aggregated.length === 0) return doc

    if (!d.content) {
      d.content = { blocks: aggregated }
    } else {
      d.content.blocks = aggregated
    }
  } catch {
    // Best-effort — in-memory aggregation must never break a read.
  }

  return doc
}
