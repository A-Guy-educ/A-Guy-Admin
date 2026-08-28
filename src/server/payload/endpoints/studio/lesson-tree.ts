/**
 * GET /api/studio/lessons/:id/tree
 *
 * Returns a lesson with all its exercises and all their sections in a single
 * response, so the Lesson Studio page can render the whole tree without N+1
 * round-trips (previous per-editor fetches saturated the pool at ~40 requests
 * for a 20-exercise lesson).
 *
 * Access: admin only.
 * Query cost: 3 Payload calls — lesson, exercises-by-lesson, sections-by-id
 * (resolved from each exercise's `blocks` playlist so duplicated data whose
 * `section.exercise` back-reference still points at the original exercise
 * still shows up correctly, matching the web renderer's resolution path).
 *
 * @fileType api-route
 * @domain admin-studio
 * @ai-summary Fetches a lesson + all descendant exercises/sections in one payload for the Studio editor.
 */
import type { PayloadRequest } from 'payload'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'
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
  content?: { blocks?: ContentBlock[] | null } | null
}

export interface StudioTreeSection {
  id: string
  title: string | null
  blocks: ContentBlock[]
}

export interface StudioTreeExercise {
  id: string
  title: string | null
  /**
   * Exercise-level content blocks (the exercise's own `content.blocks`). The
   * endpoint bypasses `aggregateChildSectionContent` on the exercises read so
   * these are always the raw own blocks, never the flattened section content.
   * Rendered alongside sections when both are present (e.g. an intro block on
   * an exercise that also has structured child sections).
   */
  blocks: ContentBlock[]
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
function orderByPlaylist<T extends { id: string }>(children: T[], playlistIds: string[]): T[] {
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
  // Matches create-section.ts / create-exercise.ts. AdvancedContentEditor
  // can update/delete sections and exercises via the collections' own
  // isAdminOrOwner rule, so they must also be able to load the tree that
  // surfaces the studio's +Add affordances — otherwise the create endpoints
  // are permissive but unreachable for that role.
  const role = 'role' in user ? (user.role as AccountRole) : null
  const allowed = role === AccountRole.Admin || (role !== null && isAdvancedContentEditor(role))
  if (!allowed) {
    return Response.json(
      { error: 'Admin or advanced content editor access required' },
      { status: 403 },
    )
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

  // Fetch all exercises for this lesson in ONE query. We skip
  // `aggregateChildSectionContent` here so `exercise.content.blocks` stays as
  // the exercise's own blocks — otherwise we can't distinguish "the exercise
  // has intro blocks of its own" from "the hook flattened section content
  // into content.blocks," and the studio would either drop the former or
  // render the latter twice.
  const exercisesResult = await req.payload.find({
    collection: 'exercises',
    where: { lesson: { equals: lessonId } },
    depth: 0,
    limit: 500,
    req,
    context: { _skipAggregateChildSectionContent: true },
  })
  const exercises = exercisesResult.docs as unknown as ExerciseDoc[]

  // Walk each exercise's `blocks` playlist to gather the section IDs it
  // references. This is the SAME resolution path the web renderer uses
  // (playlist is source of truth) instead of the back-reference `section.exercise`.
  //
  // Why: duplicated lessons can leave section documents whose back-reference
  // still points at the ORIGINAL exercise even though the duplicate's playlist
  // references them correctly. A back-reference query
  // (`sections.find({ exercise: { in: exerciseIds } })`) returns zero for
  // those sections, so the studio would render an exercise as if it had no
  // sections while the web renderer shows them just fine. Following the
  // forward playlist matches the web renderer and works for both duplicated
  // and non-duplicated data.
  const sectionIdsByExercise = new Map<string, string[]>()
  const allSectionIds = new Set<string>()
  for (const exercise of exercises) {
    const playlistIds: string[] = []
    for (const entry of parseBlocks(exercise.blocks)) {
      if (entry.blockType !== 'sectionRef') continue
      const id = extractRefId(entry.section)
      if (id) {
        playlistIds.push(id)
        allSectionIds.add(id)
      }
    }
    sectionIdsByExercise.set(exercise.id, playlistIds)
  }

  const sectionById = new Map<string, SectionDoc>()
  if (allSectionIds.size > 0) {
    const sectionsResult = await req.payload.find({
      collection: 'sections',
      where: { id: { in: Array.from(allSectionIds) } },
      depth: 0,
      limit: allSectionIds.size,
      req,
    })
    for (const s of sectionsResult.docs as unknown as SectionDoc[]) {
      sectionById.set(s.id, s)
    }
  }

  // Order exercises by the lesson's blocks playlist.
  const lessonPlaylistIds: string[] = []
  for (const entry of parseBlocks(lesson.blocks)) {
    if (entry.blockType !== 'exerciseRef') continue
    const id = extractRefId(entry.exercise)
    if (id) lessonPlaylistIds.push(id)
  }
  const orderedExercises = orderByPlaylist(exercises, lessonPlaylistIds)

  // For each exercise, iterate its playlist in order and pick sections by ID.
  // Playlist entries referencing a missing section are silently dropped
  // (same as the web renderer); duplicates in the playlist are de-duped.
  const treeExercises: StudioTreeExercise[] = orderedExercises.map((exercise) => {
    const playlistIds = sectionIdsByExercise.get(exercise.id) ?? []
    const ordered: SectionDoc[] = []
    const seen = new Set<string>()
    for (const sectionId of playlistIds) {
      const section = sectionById.get(sectionId)
      if (section && !seen.has(sectionId)) {
        ordered.push(section)
        seen.add(sectionId)
      }
    }
    const exerciseBlocks = Array.isArray(exercise.content?.blocks) ? exercise.content.blocks : []
    return {
      id: exercise.id,
      title: exercise.title ?? null,
      blocks: exerciseBlocks,
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
