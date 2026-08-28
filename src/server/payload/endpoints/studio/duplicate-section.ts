/**
 * POST /api/studio/sections/:sectionId/duplicate
 *
 * Deep-copies a section (title, exerciseType, mainSkill, content.blocks —
 * everything except managed fields + slug + ids). The copy lands under the
 * same parent exercise as the source; the Sections `afterChange` hook
 * appends the new sectionRef to the exercise's `blocks` playlist, and this
 * endpoint then reorders it to sit right after the source (rather than at
 * the end of the list, which is what "duplicate" almost never means).
 *
 * Access: admin or advanced content editor (same as sibling
 * create-section / create-exercise endpoints).
 *
 * Body: { insertAfter?: string } — override the default "after source"
 * placement. Empty body defaults to the source id.
 *
 * @fileType api-route
 * @domain admin-studio
 * @ai-summary Studio duplicate for sections — deep-copy + position after source.
 */
import type { PayloadRequest } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'
import { generateId } from '@/server/payload/collections/Exercises/defaults'

import { insertPlaylistRefAfter } from './reorder-playlist'

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

export async function duplicateSectionEndpoint(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  const role = 'role' in req.user ? (req.user.role as AccountRole) : null
  const allowed = role === AccountRole.Admin || (role !== null && isAdvancedContentEditor(role))
  if (!allowed) {
    return Response.json(
      { error: 'Admin or advanced content editor access required' },
      { status: 403 },
    )
  }

  const { sectionId } = (req.routeParams ?? {}) as { sectionId?: string }
  if (!sectionId || typeof sectionId !== 'string') {
    return Response.json({ error: 'Missing section id in path' }, { status: 400 })
  }

  await addDataAndFileToRequest(req)
  const body = (req as unknown as { data?: { insertAfter?: unknown } }).data ?? {}
  const insertAfter =
    typeof body.insertAfter === 'string' && body.insertAfter.length > 0
      ? body.insertAfter
      : sectionId

  let source: Record<string, unknown> & { id: string; exercise?: unknown }
  try {
    // Cast through `unknown` because Payload's generated `Section` type is a
    // strict shape (no index signature), so `as Record<string, unknown>` on
    // its direct return type is a type error. Semantically the doc is a plain
    // object with extra fields the generator doesn't declare (denorm fields
    // populated by hooks), so treating it as a bag here is fine.
    source = (await req.payload.findByID({
      collection: 'sections',
      id: sectionId,
      depth: 0,
      req,
    })) as unknown as Record<string, unknown> & { id: string; exercise?: unknown }
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFound') {
      return Response.json({ error: 'Source section not found' }, { status: 404 })
    }
    req.payload.logger.error({ err, sectionId }, 'studio: failed to load source section')
    return Response.json({ error: 'Failed to load source section' }, { status: 500 })
  }

  // Preserve exerciseType, mainSkill, tenant, adminTitle-relevant FKs, and
  // content.blocks by spreading source. Strip slug + translation provenance
  // (they'd otherwise collide or misattribute) and force a "- Copy" title.
  const stripped = stripManagedFields(source)
  const {
    slug: _slug,
    translatedFrom: _tf,
    createdBy: _cb,
    adminTitle: _at,
    ...rest
  } = stripped as Record<string, unknown>
  void _slug
  void _tf
  void _cb
  void _at

  // Regenerate block ids in the cloned content — the shared block factory
  // (Exercises/defaults.ts) assigns a fresh id per block on create so ids
  // are per-doc. Spreading source verbatim would carry the source's block
  // ids into the copy, making them non-unique across sections. Any code
  // that ever keys on block id assuming per-lesson uniqueness (per-block
  // progress, analytics, media joins) would silently break.
  //
  // question_multi_axis blocks also carry nested `graphs[].id` values that
  // are generated per-doc by the factory, so those are regenerated too.
  const rawContent = (rest as { content?: { blocks?: unknown } }).content
  if (rawContent && Array.isArray(rawContent.blocks)) {
    rawContent.blocks = rawContent.blocks.map((block) => {
      if (!block || typeof block !== 'object') return block
      const b = block as Record<string, unknown>
      const cloned: Record<string, unknown> = { ...b, id: generateId() }
      if (b.type === 'question_multi_axis' && Array.isArray(b.graphs)) {
        cloned.graphs = (b.graphs as Record<string, unknown>[]).map((graph) => ({
          ...graph,
          id: generateId(),
        }))
      }
      return cloned
    })
  }

  const baseTitle = typeof stripped.title === 'string' ? stripped.title : 'Untitled'
  const parentExerciseId =
    typeof source.exercise === 'string'
      ? source.exercise
      : source.exercise && typeof source.exercise === 'object' && 'id' in source.exercise
        ? String((source.exercise as { id: unknown }).id)
        : null

  try {
    const created = await req.payload.create({
      collection: 'sections',
      req,
      data: {
        ...rest,
        title: `${baseTitle} - Copy`,
      } as never,
    })

    // Move the new sectionRef right after the source in the parent exercise's
    // playlist. Same soft-fail semantics as create-section: log + continue if
    // the reorder can't complete for any reason.
    if (parentExerciseId) {
      try {
        await insertPlaylistRefAfter({
          payload: req.payload,
          req,
          parentCollection: 'exercises',
          parentId: parentExerciseId,
          blockType: 'sectionRef',
          refField: 'section',
          movedRefId: created.id,
          insertAfterRefId: insertAfter,
        })
      } catch (err) {
        req.payload.logger.warn(
          { err, parentExerciseId, newSectionId: created.id, insertAfter },
          'studio: duplicated section but failed to position it after source',
        )
      }
    }

    return Response.json({ id: created.id }, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFound') {
      return Response.json({ error: 'Source section not found' }, { status: 404 })
    }
    req.payload.logger.error({ err, sectionId }, 'studio: failed to duplicate section')
    return Response.json({ error: 'Failed to duplicate section' }, { status: 500 })
  }
}
