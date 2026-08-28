/**
 * POST /api/studio/lessons/:lessonId/exercises
 *
 * Creates a new exercise under a lesson from the Lesson Studio. The
 * exercise's `lesson` / `chapter` / `course` / `tenant` FKs are copied from
 * the parent lesson. The Exercises collection's `afterChange` hook
 * (`addBlockToLesson`) appends the new exerciseRef to the parent lesson's
 * `blocks` playlist for us.
 *
 * Access: admin only.
 * Body: { title?: string } — title is optional; defaults to a placeholder.
 *
 * @fileType api-route
 * @domain admin-studio
 * @ai-summary Studio-side create hook for exercises that auto-fills parent FKs.
 */
import type { PayloadRequest } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { AccountRole } from '@/infra/auth/roles'
import { DEFAULT_CONTENT } from '@/server/payload/collections/Exercises/defaults'

interface LessonParent {
  id: string
  chapter?: string | { id?: string } | null
  course?: string | { id?: string } | null
  tenant?: string | { id?: string } | null
}

function refId(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v
  if (v && typeof v === 'object' && 'id' in v) {
    const nested = (v as { id?: unknown }).id
    if (typeof nested === 'string' && nested.length > 0) return nested
  }
  return undefined
}

export async function createExerciseEndpoint(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in req.user) || req.user.role !== AccountRole.Admin) {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { lessonId } = (req.routeParams ?? {}) as { lessonId?: string }
  if (!lessonId || typeof lessonId !== 'string') {
    return Response.json({ error: 'Missing lesson id in path' }, { status: 400 })
  }

  await addDataAndFileToRequest(req)
  const body = (req as unknown as { data?: { title?: unknown } }).data ?? {}
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
  const title = rawTitle.length > 0 ? rawTitle : 'Untitled exercise'

  let parent: LessonParent
  try {
    parent = (await req.payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 0,
      req,
    })) as LessonParent
  } catch (err) {
    // Distinguish NotFound from real failures so incident triage isn't
    // muddled by "not found" pointing at a DB timeout or auth issue.
    if (err instanceof Error && err.name === 'NotFound') {
      return Response.json({ error: 'Parent lesson not found' }, { status: 404 })
    }
    req.payload.logger.error(
      { err, lessonId },
      'studio: failed to load parent lesson for exercise create',
    )
    return Response.json({ error: 'Failed to load parent lesson' }, { status: 500 })
  }

  try {
    const created = await req.payload.create({
      collection: 'exercises',
      req,
      data: {
        title,
        lesson: lessonId,
        chapter: refId(parent.chapter) ?? null,
        course: refId(parent.course) ?? null,
        tenant: refId(parent.tenant),
        content: DEFAULT_CONTENT(),
      } as never,
    })
    return Response.json({ id: created.id, title }, { status: 201 })
  } catch (err) {
    // Don't leak internal payload/mongo error text to the UI.
    req.payload.logger.error({ err, lessonId, title }, 'studio: failed to create exercise')
    return Response.json({ error: 'Failed to create exercise' }, { status: 500 })
  }
}
