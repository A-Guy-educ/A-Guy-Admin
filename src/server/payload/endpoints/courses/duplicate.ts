/**
 * POST /api/courses/:id/duplicate-course
 *
 * @fileType api-route
 * @domain courses
 * @pattern duplication-bulk-insert
 * @ai-summary Deep-clones a course + all chapters + lessons + exercises + sections. Delegates the bulk subtree insert to `cloneCourseTree`.
 *
 * Body: {} (no options — course duplication is always an exact copy)
 *
 * This endpoint is a thin wrapper: it creates the top-level course doc via
 * `payload.create` (single-doc hook validation is worth keeping for the root)
 * and delegates the children subtree to the shared `cloneCourseTree` engine
 * in `services/duplication/bulk-clone-tree.ts`. See that file's header for
 * the full rationale behind the raw `insertMany` path.
 *
 * Access: admin only.
 */
import { randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'

import type { PayloadRequest } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'
import { cloneCourseTree } from '@/server/services/duplication/bulk-clone-tree'
import { stripManagedFields } from '@/server/services/duplication/strip-managed-fields'

/** 6-char hex suffix used to guarantee slug uniqueness on cloned rows. */
function shortSuffix(): string {
  return randomBytes(3).toString('hex')
}

/** Convert a 24-hex string to ObjectId; leave anything else untouched. */
function toObjectIdIfHex(value: unknown): unknown {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) return value
  try {
    return new ObjectId(value)
  } catch {
    return value
  }
}

export async function duplicateCourseEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/courses\/([^/]+)\/duplicate-course/)
  const sourceCourseId = match?.[1]
  if (!sourceCourseId) {
    return Response.json({ error: 'Course id missing from path' }, { status: 400 })
  }

  // Mark the request so any hook that DOES run (course create only, in this
  // path) short-circuits its heavy work.
  markRequestAsContentPromotionImport(req)

  // 1) Load + verify the source course exists.
  const existsRes = await req.payload.find({
    collection: 'courses',
    where: { id: { equals: sourceCourseId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const sourceCourse = existsRes.docs[0] as unknown as Record<string, unknown> | undefined
  if (!sourceCourse) {
    return Response.json({ error: `Course "${sourceCourseId}" not found` }, { status: 404 })
  }

  const sourceData = stripManagedFields(sourceCourse)
  const {
    slug: sourceSlug,
    translatedFrom: _tf,
    createdBy: _cb,
    ...restCourseSource
  } = sourceData as Record<string, unknown>
  void _tf
  void _cb

  const baseTitle = typeof sourceData.title === 'string' ? sourceData.title : 'Untitled'
  const newCourseTitle = `${baseTitle} - Copy`
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(baseTitle)
  const suffix = shortSuffix()

  // 2) Create the new course via payload.create — one doc, hook validation
  //    is worth keeping for the root record.
  const newCourseData = {
    ...restCourseSource,
    title: newCourseTitle,
    slug: `${baseSlug}-copy-${suffix}`,
    status: 'draft',
  }
  const newCourse = await req.payload.create({
    collection: 'courses',
    data: newCourseData as never,
    overrideAccess: true,
    req,
  })
  const newCourseObjectId = toObjectIdIfHex(newCourse.id) as ObjectId
  const createdByObjectId = toObjectIdIfHex(user.id) as ObjectId | null

  // 3) Delegate the children subtree clone to the shared engine.
  const counts = await cloneCourseTree(req, {
    sourceCourseId,
    newCourseObjectId,
    newCourseTitle,
    createdByObjectId,
    slugSuffix: suffix,
  })

  return Response.json({ outputCourseId: newCourse.id, counts })
}
