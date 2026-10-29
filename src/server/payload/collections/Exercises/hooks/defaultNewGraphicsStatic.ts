import type { CollectionBeforeChangeHook } from 'payload'

import { defaultNewGraphicsToStatic } from '@/infra/utils/graphics/graphics-interactive'
import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'

function blocksOf(content: unknown): unknown[] | null {
  const blocks = (content as { blocks?: unknown } | null | undefined)?.blocks
  return Array.isArray(blocks) ? blocks : null
}

/**
 * New axis/geometry graphs default to a static picture (`interactive: false`),
 * whichever path created them — editor, .txt/.json import, AI generation,
 * duplication. Blocks already stored on the doc keep whatever they have, so
 * existing graphs don't change. Shared by Exercises and Sections.
 *
 * Content-promotion imports are skipped: they copy a doc between environments
 * and must land verbatim.
 */
export const defaultNewGraphicsStatic: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  req,
}) => {
  if (isContentPromotionImportRequest(req)) return data
  const incoming = blocksOf(data?.content)
  if (!incoming) return data

  const existingIds = new Set(
    (blocksOf(originalDoc?.content) ?? [])
      .map((block) => (block as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === 'string'),
  )

  return {
    ...data,
    content: { ...data.content, blocks: defaultNewGraphicsToStatic(incoming, existingIds) },
  }
}
