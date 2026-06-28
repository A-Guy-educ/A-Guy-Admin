import { randomBytes } from 'crypto'

import { PromotedCollection } from './constants'

/**
 * Maps the source-environment IDs that collide with existing target docs to
 * freshly-generated IDs. Stored keyed by `${collection}:${oldId}` to avoid
 * cross-collection ambiguity, plus a per-value reverse index used by the deep
 * walker so it doesn't have to know which collection any nested ID belongs to.
 *
 * Invariant: promoted-collection document IDs are globally unique strings
 * (24-char hex ObjectIds in practice). `byOldId` collapses the (collection,
 * id) tuple to just `id`; if two different collections ever shared the same
 * source-environment ID with different remap targets, the second `set()`
 * would clobber the first and the deep walker would rewrite nested
 * references to the wrong target. Hand-edited or non-Mongo-source bundles
 * violating this invariant trigger an explicit throw in `set()`.
 */
export class IdRemap {
  private byKey = new Map<string, string>()
  private byOldId = new Map<string, string>()

  set(collection: PromotedCollection, oldId: string, newId: string): void {
    const existingNewId = this.byOldId.get(oldId)
    if (existingNewId !== undefined && existingNewId !== newId) {
      throw new Error(
        `IdRemap collision: source ID "${oldId}" maps to two different new IDs ` +
          `(existing="${existingNewId}", new="${newId}" for collection="${collection}"). ` +
          'This violates the global-uniqueness invariant for promoted-collection IDs.',
      )
    }
    this.byKey.set(`${collection}:${oldId}`, newId)
    this.byOldId.set(oldId, newId)
  }

  get(collection: PromotedCollection, oldId: string): string | undefined {
    return this.byKey.get(`${collection}:${oldId}`)
  }

  /** Returns the new ID for any remapped value, regardless of collection. */
  rewriteAny(value: string): string | undefined {
    return this.byOldId.get(value)
  }

  size(): number {
    return this.byKey.size
  }

  entries(): IterableIterator<[string, string]> {
    return this.byKey.entries()
  }
}

/**
 * Generates an ID that matches Payload's default `text` ID type for the Mongo
 * adapter — a 24-character lowercase hex string. Picked to be visually
 * indistinguishable from existing ObjectId-shaped IDs so downstream tooling
 * (admin URLs, logs, exports) treats remapped docs the same as native ones.
 */
export function generateNewId(): string {
  return randomBytes(12).toString('hex')
}

/**
 * Recursively walks a value and rewrites any string that the remap table
 * recognises. Returns a new value — never mutates the input. Used for the
 * top-level relationship paths and for nested IDs inside exercise content
 * blocks (`mediaIds`, option content, etc.) without having to enumerate every
 * possible nested path.
 *
 * Safety invariant: this rewriter blindly rewrites any string in the tree
 * that matches a remapped ID, with no path filter. That is safe only because
 * promoted-collection IDs are 24-char hex ObjectIds — there is no realistic
 * way for a slug, title, lexical attribute, or other content string to
 * coincide with one. If the ID format ever becomes user-controlled (e.g.,
 * slugs as primary keys), this walker must be wired through REFERENCE_FIELDS
 * for top-level relationships and only fall back to deep-walking inside
 * known JSON content blocks.
 */
export function deepRewriteIds<T>(value: T, remap: IdRemap): T {
  if (typeof value === 'string') {
    const rewritten = remap.rewriteAny(value)
    return (rewritten ?? value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRewriteIds(item, remap)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
      out[key] = deepRewriteIds(sub, remap)
    }
    return out as unknown as T
  }
  return value
}
