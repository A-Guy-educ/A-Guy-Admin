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
import { regenerateBlockIds } from '@/server/services/duplication/regenerate-block-ids'
import { stripManagedFields } from '@/server/services/duplication/strip-managed-fields'

import { insertPlaylistRefAfter } from './reorder-playlist'

export async function duplicateSectionEndpoint(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  const role = 'role' in req.user ? (req.user.role as AccountRole) : null
  const allowed = role === AccountRole.Admin || (role && isAdvancedContentEditor(role))
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

  // Regenerate every per-doc id inside content.blocks (top-level block ids
  // + nested option/hotspot/graph ids + rewritten answer-key refs) via the
  // shared helper. See src/server/services/duplication/regenerate-block-ids.ts
  // for the full list of ids covered and the rationale.
  ;(rest as { content?: unknown }).content = regenerateBlockIds(
    (rest as { content?: unknown }).content,
  )

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
    // Any error at this point comes from `payload.create` or its cascade —
    // the source doc was loaded successfully above (that's the only place
    // a real "source missing" outcome can surface, and it's already mapped
    // to a 404 there). A NotFound thrown here would be a related-doc
    // lookup failure (tenant, exercise), which shouldn't be labelled
    // "Source section not found" — mislabels the failure and complicates
    // triage. Log the details and surface a generic 500.
    req.payload.logger.error({ err, sectionId }, 'studio: failed to duplicate section')
    return Response.json({ error: 'Failed to duplicate section' }, { status: 500 })
  }
}
