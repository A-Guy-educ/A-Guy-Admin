/**
 * GET /api/studio/lessons/:id/tree
 *
 * Returns a lesson with all its exercises and all their sections in a single
 * response, so the Lesson Studio page can render the whole tree without N+1
 * round-trips (previous per-editor fetches saturated the pool at ~40 requests
 * for a 20-exercise lesson).
 *
 * Access: admin only.
 * Query cost: 3 Payload calls — lesson, exercises-by-lesson, sections-by-exercise.
 *
 * @fileType api-route
 * @domain admin-studio
 * @ai-summary Fetches a lesson + all descendant exercises/sections in one payload for the Studio editor.
 */
import type { PayloadRequest } from 'payload'

import type { ContentBlock } from '@/server/payload/collections/Exercises/types'

interface BlockEntry {
  blockType?: string
  exercise?: string | { id?: string }
  section?: string | { id?: string }
}

interface SectionDoc {
  id: string
  title?: string | null
  content?: { blocks?: ContentBlock[] | null } | null
}

interface ExerciseDoc {
  id: string
  title?: string | null
  blocks?: unknown
}

export interface StudioTreeSection {
  id: string
  title: string | null
  blocks: ContentBlock[]
}

export interface StudioTreeExercise {
  id: string
  title: string | null
  sections: StudioTreeSection[]
}

export interface StudioTreeResponse {
  lesson: { id: string; title: string | null }
  exercises: StudioTreeExercise[]
}

function parseBlocks(raw: unknown): BlockEntry[] {
  if (Array.isArray(raw)) return raw as BlockEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockEntry[]
    } catch {
      // ignore
    }
  }
  return []
}

function extractRefId(val: unknown): string | null {
  if (typeof val === 'string' && val.length > 0) return val
  if (val && typeof val === 'object' && 'id' in val) {
    const nested = (val as { id?: unknown }).id
    if (typeof nested === 'string' && nested.length > 0) return nested
  }
  return null
}

/** Order children by parent's playlist, then append any orphans deterministically. */
function orderByPlaylist<T extends { id: string }>(
  children: T[],
  playlistIds: string[],
): T[] {
  const byId = new Map(children.map((c) => [c.id, c]))
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const id of playlistIds) {
    const match = byId.get(id)
    if (match && !seen.has(id)) {
      ordered.push(match)
      seen.add(id)
    }
  }
  for (const child of children) {
    if (!seen.has(child.id)) ordered.push(child)
  }
  return ordered
}

export async function lessonTreeEndpoint(req: PayloadRequest): Promise<Response> {
  const user = req.user
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!('role' in user) || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url || 'http://localhost')
  const match = url.pathname.match(/\/studio\/lessons\/([^/]+)\/tree/)
  const lessonId = match?.[1]
  if (!lessonId) {
    return Response.json({ error: 'Lesson id missing from path' }, { status: 400 })
  }

  // NOTE: we intentionally do NOT pass `overrideAccess: true` on any of these
  // reads. Payload's per-collection access rules already let admins through
  // (lessons: publishedAndActive → true for any authenticated user; exercises
  // and sections: read=anyone). Leaving access enforcement on means any
  // future tenant scoping applied to admins will keep working here instead
  // of silently leaking cross-tenant docs.
  let lesson: { id: string; title?: string | null; blocks?: unknown }
  try {
    lesson = (await req.payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 0,
      req,
    })) as { id: string; title?: string | null; blocks?: unknown }
  } catch {
    return Response.json({ error: 'Lesson not found' }, { status: 404 })
  }

  // Fetch all exercises for this lesson in ONE query.
  const exercisesResult = await req.payload.find({
    collection: 'exercises',
    where: { lesson: { equals: lessonId } },
    depth: 0,
    limit: 500,
    req,
  })
  const exercises = exercisesResult.docs as unknown as ExerciseDoc[]

  // Build exercise ID list to fetch all sections in ONE query.
  const exerciseIds = exercises.map((e) => e.id)
  let sections: SectionDoc[] = []
  if (exerciseIds.length > 0) {
    const sectionsResult = await req.payload.find({
      collection: 'sections',
      where: { exercise: { in: exerciseIds } },
      depth: 0,
      limit: 5000,
      req,
    })
    sections = sectionsResult.docs as unknown as SectionDoc[]
  }

  // Group sections by their parent exercise ID.
  const sectionsByExercise = new Map<string, SectionDoc[]>()
  for (const section of sections) {
    const parentId = extractRefId(
      (section as unknown as { exercise?: unknown }).exercise,
    )
    if (!parentId) continue
    const list = sectionsByExercise.get(parentId) ?? []
    list.push(section)
    sectionsByExercise.set(parentId, list)
  }

  // Order exercises by the lesson's blocks playlist.
  const lessonPlaylistIds: string[] = []
  for (const entry of parseBlocks(lesson.blocks)) {
    if (entry.blockType !== 'exerciseRef') continue
    const id = extractRefId(entry.exercise)
    if (id) lessonPlaylistIds.push(id)
  }
  const orderedExercises = orderByPlaylist(exercises, lessonPlaylistIds)

  // For each exercise, order its sections by the exercise's blocks playlist.
  const treeExercises: StudioTreeExercise[] = orderedExercises.map((exercise) => {
    const rawSections = sectionsByExercise.get(exercise.id) ?? []
    const playlistIds: string[] = []
    for (const entry of parseBlocks(exercise.blocks)) {
      if (entry.blockType !== 'sectionRef') continue
      const id = extractRefId(entry.section)
      if (id) playlistIds.push(id)
    }
    const ordered = orderByPlaylist(rawSections, playlistIds)
    return {
      id: exercise.id,
      title: exercise.title ?? null,
      sections: ordered.map((s) => ({
        id: s.id,
        title: s.title ?? null,
        blocks: Array.isArray(s.content?.blocks) ? s.content!.blocks! : [],
      })),
    }
  })

  const response: StudioTreeResponse = {
    lesson: { id: lesson.id, title: lesson.title ?? null },
    exercises: treeExercises,
  }
  return Response.json(response)
}
