/**
 * POST /api/studio/exercises/:exerciseId/sections
 *
 * Creates a new section under an exercise from the Lesson Studio. The
 * section's `exercise` / `lesson` / `chapter` / `course` FKs are copied from
 * the parent exercise so the studio doesn't have to know about denormalization.
 * The Sections collection's `afterChange` hook (`addBlockToExercise`) appends
 * the new sectionRef to the parent exercise's `blocks` playlist for us.
 *
 * Access: admin only.
 * Body: { title?: string } — title is optional; defaults to a placeholder.
 *
 * @fileType api-route
 * @domain admin-studio
 * @ai-summary Studio-side create hook for sections that auto-fills parent FKs.
 */
import type { PayloadRequest } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { AccountRole } from '@/infra/auth/roles'
import { DEFAULT_CONTENT } from '@/server/payload/collections/Sections/defaults'

interface ExerciseParent {
  id: string
  lesson?: string | { id?: string } | null
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

export async function createSectionEndpoint(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in req.user) || req.user.role !== AccountRole.Admin) {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { exerciseId } = (req.routeParams ?? {}) as { exerciseId?: string }
  if (!exerciseId || typeof exerciseId !== 'string') {
    return Response.json({ error: 'Missing exercise id in path' }, { status: 400 })
  }

  await addDataAndFileToRequest(req)
  const body = (req as unknown as { data?: { title?: unknown } }).data ?? {}
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
  const title = rawTitle.length > 0 ? rawTitle : 'Untitled section'

  let parent: ExerciseParent
  try {
    parent = (await req.payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      req,
    })) as ExerciseParent
  } catch (err) {
    // Payload throws a `NotFound` error (name === 'NotFound') for missing docs.
    // Anything else is a real failure (DB timeout, access denial, etc.) and
    // deserves a 500 with a log entry so we don't quietly report "not found"
    // for problems that aren't. Same pattern as other studio endpoints.
    if (err instanceof Error && err.name === 'NotFound') {
      return Response.json({ error: 'Parent exercise not found' }, { status: 404 })
    }
    req.payload.logger.error(
      { err, exerciseId },
      'studio: failed to load parent exercise for section create',
    )
    return Response.json({ error: 'Failed to load parent exercise' }, { status: 500 })
  }

  try {
    const created = await req.payload.create({
      collection: 'sections',
      req,
      data: {
        title,
        // Sections declare `exerciseType: required: true` with no default and no
        // beforeValidate backfill (Sections/index.ts:577-590). Payload rejects
        // the create without this — matches every other in-repo section
        // creator (import-text-lesson, import-lesson, convert-latex-block).
        exerciseType: 'basic',
        exercise: exerciseId,
        lesson: refId(parent.lesson) ?? null,
        chapter: refId(parent.chapter) ?? null,
        course: refId(parent.course) ?? null,
        tenant: refId(parent.tenant),
        content: DEFAULT_CONTENT(),
      } as never,
    })
    return Response.json({ id: created.id, title }, { status: 201 })
  } catch (err) {
    // Never leak raw payload/mongo error messages to the client — they can
    // include internal field names, stack fragments, or db-specific detail.
    // Log server-side and surface a stable, user-safe message.
    req.payload.logger.error({ err, exerciseId, title }, 'studio: failed to create section')
    return Response.json({ error: 'Failed to create section' }, { status: 500 })
  }
}
