/**
 * POST /api/exercises/:id/duplicate-exercise
 *
 * @fileType api-route
 * @domain exercises
 * @pattern duplication-single-doc
 * @ai-summary Deep-clones an exercise + all of its sections. Rewires blocks so the copy owns its own section graph.
 *
 * Payload's built-in per-collection duplicate is a shallow field copy: it
 * copies `blocks` verbatim, so the "duplicated" exercise's sectionRef entries
 * still point at the SOURCE section documents. Any admin edit on a section
 * from the copy silently mutates the source, and vice-versa. This endpoint
 * exists to fix that.
 *
 * The Exercises collection has `disableDuplicate: true` so Payload's built-in
 * duplicate route doesn't shadow this one (see `duplicateLessonEndpoint` for
 * the same rationale on the lessons side, PR #<n>).
 *
 * Body: {} (no options — exercise duplication is always an exact copy).
 *
 * The new exercise lives under the same lesson as the source (matching the
 * built-in Payload duplicate's behavior). It's created as a draft
 * regardless of the source's status; the section clones inherit
 * lesson/chapter/course FKs from the source exercise's stored FKs.
 *
 * Access: admin or advanced content editor. Matches the Exercises
 * collection's own `isAdminOrOwner` update/delete rule, so callers who are
 * authorised to modify exercises are also authorised to duplicate them —
 * previously stricter (admin-only) which meant the studio Duplicate button
 * silently 403'd for content editors even though they could edit the source.
 *
 * Note on `overrideAccess: true`: the section-clone helper below is called
 * with overrideAccess so it can write across per-collection ownership
 * checks (sections belonging to the same lesson may have different owners).
 * This is intentional — an editor authorised to duplicate an exercise is
 * implicitly authorised to create the child sections needed to represent
 * the copy, regardless of who owns each source section. The role check at
 * entry is the gate that authorises the whole cascade.
 */
import type { PayloadRequest } from 'payload'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'
import {
  cloneSectionsAndRewireExercises,
  type ExerciseClonePair,
} from '@/server/services/duplication/clone-sections-for-exercises'

/** Strip Payload-managed virtual fields so a doc is safe to spread into `create`. */
function stripManagedFields<T extends Record<string, unknown>>(
  doc: T,
): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = doc as T & {
    id?: unknown
    createdAt?: unknown
    updatedAt?: unknown
  }
  void _id
  void _c
  void _u
  return rest
}

/** Read a possibly-populated relationship field as a plain id string. */
function relId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

export async function duplicateExerciseEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  // Match the Exercises collection's own `isAdminOrOwner` access rule.
  // AdvancedContentEditor can update/delete exercises at the collection
  // level, and every studio create/duplicate endpoint accepts both roles —
  // if this endpoint stayed admin-only, the studio's "Duplicate exercise"
  // button (which calls into here) would 403 for content editors.
  const role = 'role' in user ? (user.role as AccountRole) : null
  const allowed = role === AccountRole.Admin || (role !== null && isAdvancedContentEditor(role))
  if (!allowed) {
    return Response.json(
      { error: 'Admin or advanced content editor access required' },
      { status: 403 },
    )
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/exercises\/([^/]+)\/duplicate-exercise/)
  const sourceExerciseId = match?.[1]
  if (!sourceExerciseId) {
    return Response.json({ error: 'Exercise id missing from path' }, { status: 400 })
  }

  // 1) Load source. depth:0 keeps FKs as ids we can pass straight into create.
  let source: Record<string, unknown> & { id: string }
  try {
    source = (await req.payload.findByID({
      collection: 'exercises',
      id: sourceExerciseId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Record<string, unknown> & { id: string }
  } catch {
    return Response.json({ error: `Exercise "${sourceExerciseId}" not found` }, { status: 404 })
  }

  // 2) Build new exercise data. Same shape as the lesson deep-clone path:
  //    strip managed fields + `blocks` (blocks reference source sections and
  //    would carry stale ids into the new doc), spread everything else,
  //    force draft status, clear translation/authorship provenance.
  const stripped = stripManagedFields(source)
  const {
    blocks: sourceBlocks,
    slug: _sourceSlug,
    translatedFrom: _tf,
    createdBy: _cb,
    ...restSource
  } = stripped as Record<string, unknown>
  void _sourceSlug
  void _tf
  void _cb

  const baseTitle = typeof stripped.title === 'string' ? stripped.title : 'Untitled'
  const newExerciseData = {
    ...restSource,
    title: `${baseTitle} - Copy`,
    status: 'draft',
    // Empty playlist on create — the section-clone helper populates blocks
    // below once the new sections exist.
    blocks: '[]',
  }

  // 3) Create the new exercise under the same lesson as the source. The
  //    Exercise afterChange auto-appends an exerciseRef to lesson.blocks —
  //    that's what we want for standalone duplicate (the built-in Payload
  //    duplicate had the same effect).
  const newExercise = await req.payload.create({
    collection: 'exercises',
    data: newExerciseData as never,
    overrideAccess: true,
    req,
  })

  // 4) Clone every section referenced from the source exercise's block
  //    playlist and rewrite the new exercise's `blocks` so its sectionRef
  //    entries point at the freshly-created sections. FKs on the new
  //    section docs mirror the source exercise's stored parent chain — this
  //    matches the built-in duplicate's "same lesson" placement.
  const pair: ExerciseClonePair = {
    sourceExerciseId: source.id,
    sourceBlocks,
    newExerciseId: newExercise.id,
    newLessonId: relId(source.lesson),
    newChapterId: relId(source.chapter),
    newCourseId: relId(source.course),
  }
  const sectionResult = await cloneSectionsAndRewireExercises(req.payload, req, [pair])

  if (sectionResult.sectionsFailed > 0) {
    req.payload.logger.warn(
      `[duplicateExerciseEndpoint] ${sectionResult.sectionsFailed} section(s) failed to clone for exercise ${sourceExerciseId}`,
    )
  }

  return Response.json({
    outputExerciseId: newExercise.id,
    counts: {
      sectionsCloned: sectionResult.sectionsCreated,
      sectionsFailed: sectionResult.sectionsFailed,
    },
  })
}
