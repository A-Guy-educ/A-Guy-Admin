import type { FieldHook } from 'payload'

import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'
import { formatSlug } from './formatSlug'

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

  // Content-promotion imports carry per-lesson-unique slugs verbatim from
  // the source (they were enforced by this same hook when the exercise was
  // originally authored). Re-checking here costs one Mongo find per
  // exercise — on a 525-exercise course that's ~525 unnecessary round trips
  // and enough to push the whole import past Vercel's 5-min function
  // ceiling. Trust the bundle's slug values during import.
  if (isContentPromotionImportRequest(req)) {
    return value
  }

  const title =
    siblingData.title || (typeof originalDoc?.title === 'string' ? originalDoc.title : null)

  if (!title) {
    return value || undefined
  }

  const payload = req.payload
  const lessonId =
    siblingData.lesson || (typeof originalDoc?.lesson === 'string' ? originalDoc.lesson : null)

  if (!lessonId) {
    return value || formatSlug(title)
  }

  const baseSlug = value || formatSlug(title)
  let slug = baseSlug
  let counter = 1

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const existing = await payload.find({
      collection: 'exercises',
      where: {
        and: [{ lesson: { equals: lessonId } }, { slug: { equals: slug } }],
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
  // unique-per-lesson on the source, and re-validating each one costs
  // another Mongo find per exercise on top of the generateSlug find,
  // doubling the per-doc round-trip count.
  if (isContentPromotionImportRequest(req)) {
    return value
  }

  const payload = req.payload
  const lessonId =
    siblingData.lesson || (typeof originalDoc?.lesson === 'string' ? originalDoc.lesson : null)

  if (!lessonId) {
    return value
  }

  const existing = await payload.find({
    collection: 'exercises',
    where: {
      and: [{ lesson: { equals: lessonId } }, { slug: { equals: value } }],
    },
    limit: 2,
    depth: 0,
    req,
  })

  for (const doc of existing.docs) {
    if (doc.id !== originalDoc?.id) {
      throw new Error(`An exercise with this slug already exists in this lesson`)
    }
  }

  return value
}
