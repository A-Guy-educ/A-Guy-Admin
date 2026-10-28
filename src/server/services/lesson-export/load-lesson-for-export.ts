/**
 * Fetch a lesson, its ordered exercises (exerciseRef playlist order) and each
 * exercise's ordered sections (sectionRef playlist order) for export. Shared
 * by the v2 text export and the full-lesson JSON export.
 */
import type { PayloadRequest } from 'payload'

type Doc = Record<string, unknown>

type BlockEntry = {
  id: string
  blockType: string
  exercise?: string
  section?: string
}

export interface LessonExportDocs {
  lesson: Doc
  exerciseDocs: Doc[]
  sectionsByExerciseId: Map<string, Doc[]>
}

/** Parse a playlist from JSON string or array */
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

async function loadExercises(req: PayloadRequest, lesson: Doc): Promise<Doc[]> {
  const exerciseIds = parseBlocks(lesson.blocks)
    .filter((b) => b.blockType === 'exerciseRef' && b.exercise)
    .map((b) => b.exercise as string)

  // Opt out of the aggregate-child-sections hook so exercise.content.blocks
  // holds only the exercise's own intro blocks — sections are fetched
  // separately so section boundaries survive (same as studio/lesson-tree.ts).
  const docs: Doc[] = []
  for (const exId of exerciseIds) {
    try {
      docs.push(
        (await req.payload.findByID({
          collection: 'exercises',
          id: exId,
          depth: 0,
          overrideAccess: true,
          req,
          context: { _skipAggregateChildSectionContent: true },
        })) as unknown as Doc,
      )
    } catch {
      // Skip missing exercises
    }
  }
  return docs
}

/**
 * Legacy exercises keep questions inline and have no sectionRef entries —
 * they simply get no map entry.
 */
async function loadSections(req: PayloadRequest, exerciseDocs: Doc[]): Promise<Map<string, Doc[]>> {
  const idsByExercise = new Map<string, string[]>()
  const allIds = new Set<string>()
  for (const ex of exerciseDocs) {
    const ids = parseBlocks(ex.blocks)
      .filter((e) => e.blockType === 'sectionRef' && typeof e.section === 'string')
      .map((e) => e.section as string)
    ids.forEach((id) => allIds.add(id))
    idsByExercise.set(ex.id as string, ids)
  }

  const out = new Map<string, Doc[]>()
  if (allIds.size === 0) return out

  const result = await req.payload.find({
    collection: 'sections',
    where: { id: { in: Array.from(allIds) } },
    depth: 0,
    limit: allIds.size,
    overrideAccess: true,
    req,
  })
  const byId = new Map((result.docs as unknown as Doc[]).map((s) => [s.id as string, s]))
  for (const [exId, ids] of idsByExercise) {
    const ordered = ids.map((id) => byId.get(id)).filter((d): d is Doc => Boolean(d))
    if (ordered.length > 0) out.set(exId, ordered)
  }
  return out
}

/** Returns null when the lesson doesn't exist. */
export async function loadLessonForExport(
  req: PayloadRequest,
  lessonId: string,
): Promise<LessonExportDocs | null> {
  let lesson: Doc
  try {
    lesson = (await req.payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Doc
  } catch {
    return null
  }
  const exerciseDocs = await loadExercises(req, lesson)
  const sectionsByExerciseId = await loadSections(req, exerciseDocs)
  return { lesson, exerciseDocs, sectionsByExerciseId }
}
