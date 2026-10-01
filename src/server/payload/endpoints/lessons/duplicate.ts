/**
 * POST /api/lessons/:id/duplicate
 *
 * @fileType api-route
 * @domain lessons
 * @pattern duplication-job
 * @ai-summary Creates a LessonDuplications record. For level=none, deep-clones the lesson + exercises inline.
 *
 * Body: { level: 'none' | 'light' | 'medium' | 'deep' }
 *
 * - level=none: clone source lesson (and all its exercises) synchronously,
 *   set outputLesson + status=succeeded, return { id, outputLessonId }.
 * - level=light|medium|deep: create a pending record and return { id }.
 *   The actual variation work is handled by later tasks (orchestrator job).
 *
 * Access: admin only.
 */
import type { PayloadRequest } from 'payload'

import {
  DUPLICATION_LEVELS,
  DUPLICATION_SUBJECTS,
  type DuplicationLevel,
  type DuplicationSubject,
} from '@/server/payload/collections/LessonDuplications'
import { deepCloneLesson } from '@/server/services/duplication/clone-lesson'

interface DuplicateBody {
  level?: unknown
  subject?: unknown
}

const isLevel = (v: unknown): v is DuplicationLevel =>
  typeof v === 'string' && (DUPLICATION_LEVELS as readonly string[]).includes(v)

const isSubject = (v: unknown): v is DuplicationSubject =>
  typeof v === 'string' && (DUPLICATION_SUBJECTS as readonly string[]).includes(v)

export async function duplicateLessonEndpoint(req: PayloadRequest): Promise<Response> {
  // 1) Auth — admin only
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  // 2) Lesson id from path: /lessons/:id/duplicate-variation
  // Path was renamed from /duplicate to /duplicate-variation because Payload's
  // built-in collection duplicate handler also registers /lessons/:id/duplicate
  // and shadowed our custom endpoint, silently routing requests to its dumb
  // field-copy instead.
  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/lessons\/([^/]+)\/duplicate(?:-variation)?/)
  const lessonId = match?.[1]
  if (!lessonId) {
    return Response.json({ error: 'Lesson id missing from path' }, { status: 400 })
  }

  // 3) Parse + validate body
  let body: DuplicateBody = {}
  try {
    if (req.json) {
      body = (await req.json()) as DuplicateBody
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!isLevel(body.level)) {
    return Response.json(
      { error: `level must be one of: ${DUPLICATION_LEVELS.join(', ')}` },
      { status: 400 },
    )
  }
  const level: DuplicationLevel = body.level

  // 4) Validate subject (required for level != none)
  let subject: DuplicationSubject | undefined
  if (level !== 'none') {
    if (!isSubject(body.subject)) {
      return Response.json(
        { error: `subject must be one of: ${DUPLICATION_SUBJECTS.join(', ')}` },
        { status: 400 },
      )
    }
    subject = body.subject
  }

  // 5) Verify source lesson exists
  try {
    await req.payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch {
    return Response.json({ error: `Lesson "${lessonId}" not found` }, { status: 404 })
  }

  // 5) Create the duplication record
  const record = await req.payload.create({
    collection: 'lesson-duplications',
    data: {
      sourceLesson: lessonId,
      level,
      subject,
      status: 'pending',
    } as never,
    overrideAccess: true,
    req,
  })

  // 7) For level=none, deep-clone immediately
  if (level === 'none') {
    try {
      const outputLessonId = await deepCloneLesson(req, lessonId)
      const updated = await req.payload.update({
        collection: 'lesson-duplications',
        id: record.id,
        data: { outputLesson: outputLessonId, status: 'succeeded' } as never,
        overrideAccess: true,
        req,
      })
      return Response.json({ id: updated.id, outputLessonId, status: 'succeeded' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      await req.payload.update({
        collection: 'lesson-duplications',
        id: record.id,
        data: { status: 'failed' } as never,
        overrideAccess: true,
        req,
      })
      return Response.json(
        { error: `Deep clone failed: ${message}`, id: record.id },
        { status: 500 },
      )
    }
  }

  // 8) For light/medium/deep, just leave the record in `pending`. The
  //    cron worker at /api/cron/process-duplications polls every minute and
  //    runs the orchestrator with a wall-clock budget. The orchestrator is
  //    resumable: each completed exercise is streamed to the record, so a
  //    Vercel function timeout mid-run leaves clean partial state and the
  //    next cron tick continues. No fire-and-forget HTTP, no Payload
  //    job-queue indirection — the cron is the single trigger path.
  return Response.json({ id: record.id, status: 'pending' })
}
