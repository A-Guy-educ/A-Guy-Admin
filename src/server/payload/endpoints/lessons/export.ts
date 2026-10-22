/**
 * GET /api/lessons/:id/export
 *
 * Exports a lesson and all its ordered exercises as a plain-text file in the
 * v2 format consumed by /admin/lesson-json-import. Round-trips through
 * parseTextLessonV2 → convertTextExerciseV2ToSections: a lesson authored in
 * the admin (fill-in table + geometry attachment + MCQ + matching) re-imports
 * with its structure preserved.
 *
 * Access: admin only (401 unauthenticated, 403 non-admin).
 *
 * Response: Content-Type: text/plain; charset=utf-8,
 * Content-Disposition: attachment; filename="<slug>.txt"
 *
 * No internal fields (id, _id, __v, slug, origin, createdBy, tenant, locale,
 * chapter, course, pipelineVersion, etc.) appear in the output.
 *
 * @fileType api-route
 * @domain lessons
 * @pattern lesson-export
 * @ai-summary Exports a lesson and its ordered exercises as v2 plain text for admin review or re-import.
 */
import type { PayloadRequest } from 'payload'

import { buildCanonicalLessonExport } from '@/server/services/lesson-export/to-canonical-format'
import { serializeLessonToText } from '@/server/services/lesson-export/to-text-format'

type BlockEntry = {
  id: string
  blockType: string
  exercise?: string
  contentPage?: string
  section?: string
}

/** Parse blocks from JSON string or array */
function parseBlocks(raw: unknown): BlockEntry[] {
  if (Array.isArray(raw)) return raw as BlockEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockEntry[]
    } catch {
      // ignore parse errors
    }
  }
  return []
}

export async function exportLessonEndpoint(req: PayloadRequest): Promise<Response> {
  // 1) Auth — admin only
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  // 2) Extract lesson ID from path: /lessons/:id/export
  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/lessons\/([^/]+)\/export/)
  const lessonId = match?.[1]
  if (!lessonId) {
    return Response.json({ error: 'Lesson id missing from path' }, { status: 400 })
  }

  // 3) Fetch lesson with depth:0
  let lesson: Record<string, unknown>
  try {
    lesson = (await req.payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Lesson not found' }, { status: 404 })
  }

  // 4) Parse blocks, extract ordered exercise IDs (exerciseRef only)
  const blocks = parseBlocks(lesson.blocks)
  const exerciseIds: string[] = []

  for (const block of blocks) {
    if (block.blockType === 'exerciseRef' && block.exercise) {
      exerciseIds.push(block.exercise)
    }
  }

  // 5) Fetch exercises in order. We opt out of the aggregate-child-sections
  //    hook so exercise.content.blocks reflects only the exercise's own intro
  //    blocks — section content is fetched separately below so each Payload
  //    section becomes one canonical section (otherwise the hook either
  //    silently drops section content, or flattens it into exercise.blocks
  //    losing section boundaries). Same pattern as studio/lesson-tree.ts.
  const exerciseDocs: Record<string, unknown>[] = []
  for (const exId of exerciseIds) {
    try {
      const ex = (await req.payload.findByID({
        collection: 'exercises',
        id: exId,
        depth: 0,
        overrideAccess: true,
        req,
        context: { _skipAggregateChildSectionContent: true },
      })) as unknown as Record<string, unknown>
      exerciseDocs.push(ex)
    } catch {
      // Skip missing exercises
    }
  }

  // 6) For each exercise, walk its blocks playlist for sectionRef entries and
  //    fetch the referenced sections in playlist order. Modern exercises keep
  //    questions on child sections; legacy exercises have no sectionRef
  //    entries and the sections map will be empty for them (canonical
  //    converter falls back to inline-question handling).
  const sectionsByExerciseId = new Map<string, Record<string, unknown>[]>()
  const allSectionIds = new Set<string>()
  const sectionIdsByExerciseId = new Map<string, string[]>()
  for (const ex of exerciseDocs) {
    const exId = ex.id as string
    const playlistIds: string[] = []
    for (const entry of parseBlocks(ex.blocks)) {
      if (entry.blockType === 'sectionRef' && typeof entry.section === 'string') {
        playlistIds.push(entry.section)
        allSectionIds.add(entry.section)
      }
    }
    sectionIdsByExerciseId.set(exId, playlistIds)
  }

  if (allSectionIds.size > 0) {
    const sectionsResult = await req.payload.find({
      collection: 'sections',
      where: { id: { in: Array.from(allSectionIds) } },
      depth: 0,
      limit: allSectionIds.size,
      overrideAccess: true,
      req,
    })
    const sectionById = new Map<string, Record<string, unknown>>()
    for (const s of sectionsResult.docs as unknown as Record<string, unknown>[]) {
      sectionById.set(s.id as string, s)
    }
    for (const [exId, playlistIds] of sectionIdsByExerciseId) {
      const ordered: Record<string, unknown>[] = []
      for (const sid of playlistIds) {
        const doc = sectionById.get(sid)
        if (doc) ordered.push(doc)
      }
      if (ordered.length > 0) sectionsByExerciseId.set(exId, ordered)
    }
  }

  // 7) Build canonical export format, then serialize to v2 plain text. The
  //    v2 format carries no course/class label, so none is fetched.
  const canonicalExport = buildCanonicalLessonExport(lesson, exerciseDocs, '', sectionsByExerciseId)
  const body = serializeLessonToText(canonicalExport)

  const slug = (lesson.slug as string) || lessonId
  const filename = `${slug}.txt`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
