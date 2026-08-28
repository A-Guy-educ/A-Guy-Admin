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
  if (!('role' in req.user) || req.user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/studio\/exercises\/([^/]+)\/sections/)
  const exerciseId = match?.[1]
  if (!exerciseId) {
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
  } catch {
    return Response.json({ error: 'Parent exercise not found' }, { status: 404 })
  }

  const created = await req.payload.create({
    collection: 'sections',
    req,
    data: {
      title,
      exercise: exerciseId,
      lesson: refId(parent.lesson) ?? null,
      chapter: refId(parent.chapter) ?? null,
      course: refId(parent.course) ?? null,
      tenant: refId(parent.tenant),
      content: DEFAULT_CONTENT(),
    } as never,
  })

  return Response.json({ id: created.id, title }, { status: 201 })
}
