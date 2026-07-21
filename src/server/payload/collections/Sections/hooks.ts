import type { FieldHook } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'
import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'

const MAX_SLUG_ATTEMPTS = 100

export const generateSlug: FieldHook = async ({
  value,
  operation,
  originalDoc,
  siblingData,
  req,
}) => {
  if (operation === 'delete') {
    return value
  }

  // Content-promotion imports carry per-exercise-unique slugs verbatim from
  // the source (they were enforced by this same hook when the section was
  // originally authored). Re-checking here costs one Mongo find per section
  // — sections are typically more numerous than lessons per course, so the
  // wall-clock hit is worse than the ~30s the Lessons slug hook already
  // skips over via the same guard (see Lessons.ts:261). Trust the bundle's
  // slug values during import.
  if (isContentPromotionImportRequest(req)) {
    return value
  }

  const title =
    siblingData.title || (typeof originalDoc?.title === 'string' ? originalDoc.title : null)

  if (!title) {
    return value || undefined
  }

  const payload = req.payload
  const exerciseId =
    siblingData.exercise ||
    (typeof originalDoc?.exercise === 'string' ? originalDoc.exercise : null)

  if (!exerciseId) {
    return value || formatSlug(title)
  }

  const baseSlug = value || formatSlug(title)
  let slug = baseSlug
  let counter = 1

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const existing = await payload.find({
      collection: 'sections',
      where: {
        and: [{ exercise: { equals: exerciseId } }, { slug: { equals: slug } }],
      },
      limit: 1,
      depth: 0,
      req,
    })

    if (existing.docs.length === 0) {
      return slug
    }

    if (originalDoc?.id && existing.docs[0]?.id === originalDoc.id) {
      return slug
    }

    slug = `${baseSlug}-${counter}`
    counter++
  }

  throw new Error(`Unable to generate unique slug after ${MAX_SLUG_ATTEMPTS} attempts`)
}

export const validateSlugUniqueness: FieldHook = async ({
  value,
  operation,
  originalDoc,
  siblingData,
  req,
}) => {
  if (operation === 'delete' || !value) {
    return value
  }

  // Same rationale as generateSlug above — the bundle's slug was already
  // unique-per-exercise on the source, and re-validating here doubles the
  // per-doc round trips.
  if (isContentPromotionImportRequest(req)) {
    return value
  }

  const payload = req.payload
  const exerciseId =
    siblingData.exercise ||
    (typeof originalDoc?.exercise === 'string' ? originalDoc.exercise : null)

  if (!exerciseId) {
    return value
  }

  const existing = await payload.find({
    collection: 'sections',
    where: {
      and: [{ exercise: { equals: exerciseId } }, { slug: { equals: value } }],
    },
    limit: 2,
    depth: 0,
    req,
  })

  for (const doc of existing.docs) {
    if (doc.id !== originalDoc?.id) {
      throw new Error(`A section with this slug already exists in this exercise`)
    }
  }

  return value
}
