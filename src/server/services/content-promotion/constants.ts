export const BUNDLE_MANIFEST_VERSION = 1

export const MANIFEST_FILENAME = 'manifest.json'

export const BLOB_DIR = 'blobs'

/**
 * Collections promoted by the dev→prod content bundle. Order is the
 * dependency order for import (parents before children) so cross-document
 * references resolve cleanly when the IDs are threaded through.
 */
export const PROMOTED_COLLECTIONS = [
  'media',
  'courses',
  'chapters',
  'lessons',
  'exercises',
] as const

export type PromotedCollection = (typeof PROMOTED_COLLECTIONS)[number]

/**
 * For each promoted collection, the relationship/upload field paths whose values
 * point at IDs of another promoted collection. The remap walker rewrites these
 * when the import resolves an ID collision and assigns a new ID to a document.
 *
 * Refs to *non-promoted* collections (categories, prompts, formula-sheets,
 * tenants, users, etc.) are left untouched — those documents are assumed to
 * already exist on the target with their original IDs.
 */
export interface ReferenceField {
  /** Dotted path into the document, e.g. `chapter`, `prerequisites`, `meta.image`. */
  path: string
  /** Whether this field holds an array of IDs vs a single ID. */
  hasMany: boolean
  /** The promoted collection the IDs point at. */
  target: PromotedCollection
}

export const REFERENCE_FIELDS: Record<PromotedCollection, ReferenceField[]> = {
  media: [],
  courses: [{ path: 'mediaFiles', hasMany: true, target: 'media' }],
  chapters: [
    { path: 'course', hasMany: false, target: 'courses' },
    { path: 'mediaFiles', hasMany: true, target: 'media' },
  ],
  lessons: [
    { path: 'chapter', hasMany: false, target: 'chapters' },
    { path: 'course', hasMany: false, target: 'courses' },
    { path: 'contentFiles', hasMany: true, target: 'media' },
    { path: 'prerequisites', hasMany: true, target: 'lessons' },
  ],
  exercises: [
    { path: 'lesson', hasMany: false, target: 'lessons' },
    { path: 'chapter', hasMany: false, target: 'chapters' },
    { path: 'course', hasMany: false, target: 'courses' },
    { path: 'sourceDoc', hasMany: false, target: 'media' },
  ],
}
