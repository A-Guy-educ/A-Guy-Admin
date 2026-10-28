/**
 * GET /api/lessons/:id/export[?format=json]
 *
 * Default: the lesson and its ordered exercises as a plain-text file in the
 * v2 format consumed by /admin/lesson-json-import (round-trips through
 * parseTextLessonV2 → convertTextExerciseV2ToSections).
 *
 * `?format=json`: the lossless "full lesson JSON" (every block exactly as
 * stored) — meant for LLM editing and re-import through the same JSON import.
 *
 * Access: admin only (401 unauthenticated, 403 non-admin).
 *
 * No internal fields (id, _id, __v, slug, origin, createdBy, tenant, locale,
 * chapter, course, pipelineVersion, etc.) appear in either output.
 *
 * @fileType api-route
 * @domain lessons
 * @pattern lesson-export
 * @ai-summary Exports a lesson and its ordered exercises as v2 plain text or lossless JSON.
 */
import type { PayloadRequest } from 'payload'

import { loadLessonForExport } from '@/server/services/lesson-export/load-lesson-for-export'
import { buildCanonicalLessonExport } from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'
import { buildFullLessonExport } from '@/server/services/lesson-full-json/build-full-lesson-export'

export async function exportLessonEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const lessonId = url.pathname.match(/\/lessons\/([^/]+)\/export/)?.[1]
  if (!lessonId) {
    return Response.json({ error: 'Lesson id missing from path' }, { status: 400 })
  }

  const docs = await loadLessonForExport(req, lessonId)
  if (!docs) {
    return Response.json({ error: 'Lesson not found' }, { status: 404 })
  }

  const slug = (docs.lesson.slug as string) || lessonId

  if (url.searchParams.get('format') === 'json') {
    const full = buildFullLessonExport(docs.lesson, docs.exerciseDocs, docs.sectionsByExerciseId)
    return new Response(JSON.stringify(full, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.json"`,
      },
    })
  }

  // The v2 text format carries no course/class label, so none is fetched.
  const canonical = buildCanonicalLessonExport(
    docs.lesson,
    docs.exerciseDocs,
    '',
    docs.sectionsByExerciseId,
  )
  return new Response(serializeLessonToText(canonical), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.txt"`,
    },
  })
}
