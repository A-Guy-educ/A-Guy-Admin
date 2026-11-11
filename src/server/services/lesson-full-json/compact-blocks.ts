/**
 * Compact form of content blocks for the full lesson JSON — the same blocks,
 * minus the noise that makes LLMs choke on the file:
 *
 *   - Block ids are dropped (the importer always assigns fresh ones).
 *   - Inline rich text `{type, format, value, mediaIds: []}` becomes its
 *     plain Markdown string; a rich_text block becomes a bare string in the
 *     blocks array.
 *
 * Nothing here knows about individual block types. Expansion walks the real
 * ContentBlockSchema and wraps a string back into rich text only where the
 * schema expects rich text, so new block types and fields round-trip without
 * code changes. Export verifies every block expands back to the original and
 * falls back to the full block when it doesn't, so compaction is never lossy.
 */
import { isDeepStrictEqual } from 'node:util'

import {
  ContentBlockSchema,
  InlineRichTextSchema,
} from '@/server/payload/collections/Exercises/schemas'

const RICH_TEXT_TYPE = 'rich_text'
const RICH_TEXT_FORMAT = 'md-math-v1'

/** The slice of zod v4 internals the schema walk reads. */
interface SchemaNode {
  _zod: {
    def: {
      type: string
      innerType?: SchemaNode
      getter?: () => SchemaNode
      in?: SchemaNode
      element?: SchemaNode
      items?: SchemaNode[]
      rest?: SchemaNode | null
      shape?: Record<string, SchemaNode>
      options?: SchemaNode[]
      discriminator?: string
    }
    propValues?: Record<string, Set<unknown>>
  }
  safeParse(value: unknown): { success: boolean }
}

const INLINE_RICH_TEXT = InlineRichTextSchema as unknown as SchemaNode
const BLOCK_SCHEMA = ContentBlockSchema as unknown as SchemaNode

/** Wrapper types whose only job is to modify `innerType`. */
const WRAPPER_TYPES = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function richText(value: string) {
  return { type: RICH_TEXT_TYPE, format: RICH_TEXT_FORMAT, value, mediaIds: [] as string[] }
}

/** Rich text with no media — exactly what a plain string expands back to. */
function isPlainRichText(value: unknown): value is { value: string } {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === 4 &&
    value.type === RICH_TEXT_TYPE &&
    value.format === RICH_TEXT_FORMAT &&
    typeof value.value === 'string' &&
    Array.isArray(value.mediaIds) &&
    value.mediaIds.length === 0
  )
}

function collapse(value: unknown): unknown {
  if (isPlainRichText(value)) return value.value
  if (Array.isArray(value)) return value.map(collapse)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, collapse(v)]))
}

function expandUnion(def: SchemaNode['_zod']['def'], value: unknown): unknown {
  const options = def.options ?? []
  if (def.discriminator && isRecord(value)) {
    const tag = value[def.discriminator]
    const option = options.find((opt) => opt._zod.propValues?.[def.discriminator!]?.has(tag))
    return option ? expandAgainst(option, value) : value
  }
  for (const option of options) {
    const expanded = expandAgainst(option, value)
    if (option.safeParse(expanded).success) return expanded
  }
  return value
}

function expandAgainst(schema: SchemaNode, value: unknown): unknown {
  if (schema === INLINE_RICH_TEXT) return typeof value === 'string' ? richText(value) : value
  const def = schema._zod.def
  if (WRAPPER_TYPES.has(def.type) && def.innerType) return expandAgainst(def.innerType, value)
  switch (def.type) {
    case 'lazy':
      return def.getter ? expandAgainst(def.getter(), value) : value
    case 'pipe':
      return def.in ? expandAgainst(def.in, value) : value
    case 'array':
      return Array.isArray(value) && def.element
        ? value.map((item) => expandAgainst(def.element!, item))
        : value
    case 'tuple': {
      if (!Array.isArray(value)) return value
      const items = def.items ?? []
      return value.map((item, i) => {
        const itemSchema = items[i] ?? def.rest
        return itemSchema ? expandAgainst(itemSchema, item) : item
      })
    }
    case 'object': {
      if (!isRecord(value) || !def.shape) return value
      const shape = def.shape
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          shape[key] ? expandAgainst(shape[key], v) : v,
        ]),
      )
    }
    case 'union':
      return expandUnion(def, value)
    default:
      return value
  }
}

/** Inverse of compactBlock. Full (v1) blocks pass through unchanged. */
export function expandBlock(block: unknown): unknown {
  if (typeof block === 'string') return richText(block)
  return expandAgainst(BLOCK_SCHEMA, block)
}

/** Compact a stored block for export; falls back to the full block if it wouldn't round-trip. */
export function compactBlock(block: unknown): unknown {
  if (!isRecord(block)) return block
  const { id: _id, ...rest } = block
  const compact = collapse(rest)
  return isDeepStrictEqual(expandBlock(compact), rest) ? compact : rest
}
