/**
 * POST /api/studio/lessons/:lessonId/reorder-exercises
 *
 * Moves an exerciseRef entry inside `lesson.blocks` so it sits right after
 * a specified sibling. The studio calls this after triggering the existing
 * prod `/api/exercises/:id/duplicate-exercise` endpoint (which appends the
 * new exercise at the end of the parent lesson's playlist) to snap the copy
 * back to the intuitive position — right below the source.
 *
 * Body: `{ movedExerciseId: string, insertAfterExerciseId: string }`
 *
 * Access: admin or advanced content editor (matches
 * `/api/exercises/:id/duplicate-exercise` and the sibling studio endpoints).
 *
 * @fileType api-route
 * @domain admin-studio
 * @ai-summary Studio-side playlist reorder for exercises inside a lesson.
 */
import type { PayloadRequest } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'

import { insertPlaylistRefAfter } from './reorder-playlist'

export async function reorderLessonExercisesEndpoint(req: PayloadRequest): Promise<Response> {
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

  const { lessonId } = (req.routeParams ?? {}) as { lessonId?: string }
  if (!lessonId || typeof lessonId !== 'string') {
    return Response.json({ error: 'Missing lesson id in path' }, { status: 400 })
  }

  await addDataAndFileToRequest(req)
  const body =
    (req as unknown as { data?: { movedExerciseId?: unknown; insertAfterExerciseId?: unknown } })
      .data ?? {}
  const movedExerciseId = typeof body.movedExerciseId === 'string' ? body.movedExerciseId : ''
  const insertAfterExerciseId =
    typeof body.insertAfterExerciseId === 'string' ? body.insertAfterExerciseId : ''
  if (!movedExerciseId || !insertAfterExerciseId) {
    return Response.json(
      { error: 'movedExerciseId and insertAfterExerciseId are required' },
      { status: 400 },
    )
  }

  try {
    await insertPlaylistRefAfter({
      payload: req.payload,
      req,
      parentCollection: 'lessons',
      parentId: lessonId,
      blockType: 'exerciseRef',
      refField: 'exercise',
      movedRefId: movedExerciseId,
      insertAfterRefId: insertAfterExerciseId,
    })
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof Error && err.name === 'NotFound') {
      return Response.json({ error: 'Lesson not found' }, { status: 404 })
    }
    req.payload.logger.error(
      { err, lessonId, movedExerciseId, insertAfterExerciseId },
      'studio: failed to reorder lesson exercises',
    )
    return Response.json({ error: 'Failed to reorder' }, { status: 500 })
  }
}
