/**
 * Turn blocks read from an import file (compact or full form) into stored
 * blocks: expand, give each a fresh id — the file may carry ids from another
 * lesson (or none) — and validate against the real ContentBlockSchema. Shared
 * by the full-JSON and v2-text importers.
 */
import type { z } from 'zod'

import { ContentBlockSchema } from '@/server/payload/collections/Exercises/schemas'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'

import { expandBlock } from './compact-blocks'

export type ImportIssue = { path: string; message: string }

export function formatZodIssues(location: string, error: z.ZodError): ImportIssue[] {
  return error.issues.map((iss) => ({
    path: [location, ...iss.path.map(String)].filter(Boolean).join(' › '),
    message: iss.message,
  }))
}

/** Problems are pushed onto `issues` with a readable location ("lesson › block 3 (svg)"). */
export function prepareImportedBlocks(
  raw: unknown[],
  location: string,
  issues: ImportIssue[],
): ContentBlock[] {
  return raw.map((rawBlock, idx) => {
    const block = expandBlock(rawBlock)
    const withId =
      typeof block === 'object' && block !== null ? { ...block, id: generateId() } : block
    const blockType = (block as { type?: unknown } | null)?.type
    const label = `${location} › block ${idx + 1}${typeof blockType === 'string' ? ` (${blockType})` : ''}`
    const check = ContentBlockSchema.safeParse(withId)
    if (!check.success) issues.push(...formatZodIssues(label, check.error))
    return withId as ContentBlock
  })
}
