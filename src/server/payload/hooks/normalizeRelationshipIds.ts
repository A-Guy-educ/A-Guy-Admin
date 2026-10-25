import type { CollectionAfterReadHook } from 'payload'

type MaybePopulated = string | { id: string } | null | undefined

const toId = (value: MaybePopulated): MaybePopulated =>
  value && typeof value === 'object' && 'id' in value ? value.id : value

/**
 * Builds an afterRead hook that collapses populated relationship fields back to
 * their ID strings (hasMany arrays included), mirroring the Enrollments pattern.
 * Sibling apps read these collections and expect IDs, not nested docs.
 */
export const normalizeRelationshipIds =
  (fieldNames: readonly string[]): CollectionAfterReadHook =>
  ({ doc }) => {
    const normalized = fieldNames.reduce<Record<string, unknown>>((acc, name) => {
      const value = doc[name] as MaybePopulated | MaybePopulated[]
      if (value === undefined) return acc
      return { ...acc, [name]: Array.isArray(value) ? value.map(toId) : toId(value) }
    }, {})
    return { ...doc, ...normalized }
  }
