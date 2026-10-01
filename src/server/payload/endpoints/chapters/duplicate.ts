/**
 * POST /api/chapters/:id/duplicate-chapter
 *
 * @fileType api-route
 * @domain chapters
 * @pattern duplication-bulk-insert
 * @ai-summary Deep-clones a chapter and every lesson + exercise + section underneath it via the shared bulk-insert engine.
 *
 * Payload's built-in per-collection duplicate is a shallow field copy for
 * chapters: it creates a new chapter with the same scalar fields and the same
 * `course` FK but does NOT clone the lessons that reference it. The resulting
 * "duplicate" chapter is empty — same bug the sibling course/lesson/exercise
 * endpoints exist to fix.
 *
 * The Chapters collection has `disableDuplicate: true` so Payload's built-in
 * duplicate route doesn't shadow this one.
 *
 * PERFORMANCE — raw `insertMany` instead of per-doc `payload.create`.
 *
 * A fat chapter (~40 lessons × ~15 exercises × ~5 sections ≈ 3000 docs)
 * cloned via `payload.create` would hit the same ~40min wall time the course
 * endpoint fled from on real courses. This endpoint delegates to the shared
 * `cloneChapterTree` engine — see
 * `src/server/services/duplication/bulk-clone-tree.ts` for the full rationale.
 *
 * Body: {} (no options — chapter duplication is always an exact copy).
 *
 * Access: admin only. Matches the sibling course/lesson/exercise endpoints.
 */
import { randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'

import type { PayloadRequest } from 'payload'

import { formatSlug } from '@/server/payload/fields/formatSlug'
import { markRequestAsContentPromotionImport } from '@/server/services/content-promotion/import-context'
import { cloneChapterTree } from '@/server/services/duplication/bulk-clone-tree'
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

/** Read a possibly-populated relationship as a plain id string. */
function relId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

export async function duplicateChapterEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/chapters\/([^/]+)\/duplicate-chapter/)
  const sourceChapterId = match?.[1]
  if (!sourceChapterId) {
    return Response.json({ error: 'Chapter id missing from path' }, { status: 400 })
  }

  markRequestAsContentPromotionImport(req)

  // 1) Load source. depth:0 keeps FKs as id strings we can pass to create.
  let source: Record<string, unknown> & { id: string }
  try {
    source = (await req.payload.findByID({
      collection: 'chapters',
      id: sourceChapterId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Record<string, unknown> & { id: string }
  } catch {
    return Response.json({ error: `Chapter "${sourceChapterId}" not found` }, { status: 404 })
  }

  const courseId = relId(source.course)
  if (!courseId) {
    return Response.json(
      { error: `Chapter "${sourceChapterId}" has no course — refusing to duplicate` },
      { status: 400 },
    )
  }

  // Pull the course title for the children breadcrumb builder.
  let courseTitle = ''
  try {
    const courseDoc = await req.payload.findByID({
      collection: 'courses',
      id: courseId,
      depth: 0,
      overrideAccess: true,
      req,
    })
    courseTitle =
      typeof (courseDoc as { title?: unknown }).title === 'string'
        ? (courseDoc as { title: string }).title
        : ''
  } catch {
    // Non-fatal — the breadcrumb just loses the course segment.
  }

  // 2) Build new-chapter payload. Spread the source so the clone inherits
  //    course, chapterLabel, description, mediaFiles, order, isActive, etc.,
  //    but drop fields that shouldn't carry over to a fresh doc.
  const stripped = stripManagedFields(source)
  const {
    slug: sourceSlug,
    translatedFrom: _tf,
    createdBy: _cb,
    adminTitle: _at,
    ...rest
  } = stripped as Record<string, unknown>
  void _tf
  void _cb
  void _at

  const baseTitle = typeof stripped.title === 'string' ? stripped.title : 'Untitled'
  const newChapterTitle = `${baseTitle} - Copy`
  const suffix = shortSuffix()

  // Pre-compute the slug with a random suffix. The Chapters `slug` field has a
  // global unique index (Chapters.ts). If we omit `slug` here, Chapters'
  // `beforeChange` deterministically derives `formatSlug(title)` — so a second
  // duplicate of the same chapter produces the same slug and crashes on the
  // unique index. Chapters, unlike Lessons, has no numeric-suffix retry
  // fallback, so we have to produce a unique slug ourselves. Mirrors the
  // course-duplicate endpoint's `${baseSlug}-copy-${suffix}` pattern.
  const baseSlug =
    typeof sourceSlug === 'string' && sourceSlug.trim() ? sourceSlug : formatSlug(baseTitle)

  const newChapterData = {
    ...rest,
    title: newChapterTitle,
    slug: `${baseSlug}-copy-${suffix}`,
    status: 'draft',
  }

  let newChapter: { id: string }
  try {
    newChapter = (await req.payload.create({
      collection: 'chapters',
      data: newChapterData as never,
      overrideAccess: true,
      req,
    })) as unknown as { id: string }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown'
    req.payload.logger.error(
      { err, sourceChapterId, newChapterData: { ...newChapterData, mediaFiles: '[redacted]' } },
      '[duplicateChapterEndpoint] failed to create new chapter',
    )
    return Response.json({ error: `Failed to create new chapter: ${reason}` }, { status: 500 })
  }

  const newChapterObjectId = toObjectIdIfHex(newChapter.id) as ObjectId
  const courseObjectId = toObjectIdIfHex(courseId) as ObjectId
  const createdByObjectId = toObjectIdIfHex(user.id) as ObjectId | null

  // 3) Delegate the children subtree clone to the shared engine.
  const counts = await cloneChapterTree(req, {
    sourceChapterId,
    newChapterObjectId,
    newChapterTitle,
    courseObjectId,
    courseTitle,
    createdByObjectId,
    slugSuffix: suffix,
  })

  return Response.json({ outputChapterId: newChapter.id, counts })
}
