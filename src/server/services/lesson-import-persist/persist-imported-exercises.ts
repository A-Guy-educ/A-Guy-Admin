/**
 * Shared write path for the lesson importers (v2 text, full JSON): resolve or
 * create the target lesson, create one Exercise + its Sections per prepared
 * exercise, roll everything back on any failure, then write the lesson.blocks
 * playlist once at the end so the per-exercise afterChange hook doesn't race.
 */
import type { PayloadRequest } from 'payload'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import { getDefaultTenantId } from '@/server/repos/tenant/get-default-tenant'

export type LessonType = 'learning' | 'practice' | 'exam'

export interface PreparedSection {
  title: string
  blocks: ContentBlock[]
  /** Extra Section fields (exerciseType, mainSkill, …). exerciseType defaults to 'basic'. */
  fields?: Record<string, unknown>
}

export interface PreparedExercise {
  exerciseNumber: string
  title: string
  sharedBlocks: ContentBlock[]
  sections: PreparedSection[]
  /** Extra Exercise fields (subject, topic, …). */
  fields?: Record<string, unknown>
}

export interface PersistTarget {
  /** Required when creating a NEW lesson. Ignored when `targetLessonId` is set. */
  chapterId?: string
  /** Append to this existing lesson instead of creating one. */
  targetLessonId?: string
  /** Title for a newly-created lesson. */
  lessonTitle: string
  /** Lesson.type for a newly-created lesson (defaults to `learning`). */
  lessonType?: LessonType
}

export interface ImportedExerciseResult {
  exerciseNumber: string
  id?: string
  error?: string
}

export interface ImportLessonResult {
  success: boolean
  lessonId: string
  lessonTitle: string
  exercisesCreated: number
  exercisesFailed: number
  results: ImportedExerciseResult[]
}

export interface ImportLessonValidationError {
  kind: 'validation'
  issues: Array<{ path: string; message: string }>
}

export interface ImportLessonNotFoundError {
  kind: 'not_found'
  message: string
}

export type ImportLessonError = ImportLessonValidationError | ImportLessonNotFoundError

type CreatedIds = { exercises: string[]; sections: string[] }
type ResolvedLesson = { id: string; title: string; existingBlocks: Array<Record<string, unknown>> }

function emptyRichTextPlaceholder() {
  return {
    id: generateId(),
    type: 'rich_text' as const,
    format: 'md-math-v1' as const,
    value: '',
    mediaIds: [],
  }
}

/** Parse the existing lesson.blocks textarea payload back into an array. */
function parseExistingBlocks(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
    } catch {
      /* fall through */
    }
  }
  return []
}

async function nextOrder(
  req: PayloadRequest,
  collection: 'lessons' | 'exercises',
  where: Record<string, unknown>,
): Promise<number> {
  const existing = await req.payload.find({
    collection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: where as any,
    sort: '-order',
    limit: 1,
    depth: 0,
    req,
    overrideAccess: true,
  })
  const top = existing.docs[0] as { order?: number } | undefined
  return (top?.order ?? -1) + 1
}

async function resolveLesson(
  req: PayloadRequest,
  target: PersistTarget,
): Promise<ResolvedLesson | ImportLessonNotFoundError> {
  if (target.targetLessonId) {
    const existing = await req.payload.findByID({
      collection: 'lessons',
      id: target.targetLessonId,
      depth: 0,
      req,
      overrideAccess: false,
      user: req.user,
    })
    if (!existing) return { kind: 'not_found', message: 'Lesson not found' }
    return {
      id: existing.id,
      title: (existing as { title?: string }).title ?? '',
      existingBlocks: parseExistingBlocks((existing as { blocks?: unknown }).blocks),
    }
  }

  // chapterId is guaranteed by the caller's early guard.
  const chapterId = target.chapterId as string
  const chapter = await req.payload.findByID({
    collection: 'chapters',
    id: chapterId,
    depth: 0,
    req,
    overrideAccess: false,
    user: req.user,
  })
  if (!chapter) return { kind: 'not_found', message: 'Chapter not found' }

  const order = await nextOrder(req, 'lessons', { chapter: { equals: chapterId } })
  const created = await req.payload.create({
    collection: 'lessons',
    data: {
      locale: 'he',
      chapter: chapterId,
      type: target.lessonType ?? 'learning',
      title: target.lessonTitle,
      order,
      status: 'draft',
      isActive: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    req,
    overrideAccess: false,
    user: req.user,
  })
  return { id: created.id, title: created.title, existingBlocks: [] }
}

function formatIssues(prefix: string, blocks: ContentBlock[]): string | undefined {
  const check = ContentSchema.safeParse({ blocks })
  if (check.success) return undefined
  const issues = check.error.issues
    .map((iss) => `[${iss.path.join('.')}] ${iss.message}`)
    .join('; ')
  return prefix ? `${prefix}: ${issues}` : issues
}

/** Validate + create one exercise and its sections. Returns the error string on failure. */
async function createExercise(
  req: PayloadRequest,
  lessonId: string,
  order: number,
  tenantId: string | undefined,
  ex: PreparedExercise,
  created: CreatedIds,
): Promise<string | { id: string }> {
  const sharedBlocks = ex.sharedBlocks.length > 0 ? ex.sharedBlocks : [emptyRichTextPlaceholder()]
  const contentError = formatIssues('', sharedBlocks)
  if (contentError) return contentError
  for (let sIdx = 0; sIdx < ex.sections.length; sIdx++) {
    const sectionError = formatIssues(`Section ${sIdx + 1}`, ex.sections[sIdx].blocks)
    if (sectionError) return sectionError
  }

  const exercise = await req.payload.create({
    collection: 'exercises',
    data: {
      ...ex.fields,
      locale: 'he',
      lesson: lessonId,
      title: ex.title,
      order,
      content: { blocks: sharedBlocks },
      origin: 'import',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    req,
    overrideAccess: true,
    user: req.user,
    context: { _skipBlockSync: true },
  })
  created.exercises.push(exercise.id)

  const sectionIds: string[] = []
  for (let sIdx = 0; sIdx < ex.sections.length; sIdx++) {
    const section = ex.sections[sIdx]
    const createdSection = await req.payload.create({
      collection: 'sections',
      data: {
        exerciseType: 'basic',
        ...section.fields,
        tenant: tenantId,
        locale: 'he',
        title: section.title,
        exercise: exercise.id,
        order: sIdx,
        content: { blocks: section.blocks },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      req,
      overrideAccess: true,
      user: req.user,
      context: { _skipExerciseBlockSync: true },
    })
    sectionIds.push(createdSection.id)
    created.sections.push(createdSection.id)
  }

  await req.payload.update({
    collection: 'exercises',
    id: exercise.id,
    data: {
      blocks: JSON.stringify(
        sectionIds.map((id) => ({
          id: Math.random().toString(36).slice(2, 14),
          blockType: 'sectionRef' as const,
          section: id,
        })),
      ),
    },
    req,
    overrideAccess: true,
    context: { _skipExerciseBlockSync: true },
  })
  return { id: exercise.id }
}

async function rollback(
  req: PayloadRequest,
  created: CreatedIds,
  lessonId: string | null,
): Promise<void> {
  const targets: Array<['sections' | 'exercises' | 'lessons', string]> = [
    ...created.sections.map((id) => ['sections', id] as ['sections', string]),
    ...created.exercises.map((id) => ['exercises', id] as ['exercises', string]),
    ...(lessonId ? [['lessons', lessonId] as ['lessons', string]] : []),
  ]
  for (const [collection, id] of targets) {
    try {
      await req.payload.delete({ collection, id, req, overrideAccess: true })
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Append exerciseRefs to lesson.blocks in one write. In append-mode, re-read
 * lesson.blocks first so anything written during our multi-second create loop
 * still lands in the final playlist.
 */
async function writeLessonPlaylist(
  req: PayloadRequest,
  lesson: ResolvedLesson,
  appendMode: boolean,
  exerciseIds: string[],
): Promise<void> {
  const newBlocks = exerciseIds.map((exerciseId) => ({
    id: Math.random().toString(36).slice(2, 14),
    blockType: 'exerciseRef' as const,
    exercise: exerciseId,
  }))
  let baseBlocks = lesson.existingBlocks
  if (appendMode) {
    try {
      const fresh = await req.payload.findByID({
        collection: 'lessons',
        id: lesson.id,
        depth: 0,
        req,
        overrideAccess: true,
      })
      baseBlocks = parseExistingBlocks((fresh as { blocks?: unknown }).blocks)
    } catch (err) {
      console.error('[lesson-import] failed to re-read lesson.blocks; using snapshot', err)
    }
  }
  try {
    await req.payload.update({
      collection: 'lessons',
      id: lesson.id,
      data: { blocks: JSON.stringify([...baseBlocks, ...newBlocks]) },
      req,
      overrideAccess: true,
      context: { _skipBlockSync: true },
    })
  } catch (err) {
    console.error('[lesson-import] failed to write lesson.blocks playlist', err)
  }
}

export async function persistImportedExercises(
  req: PayloadRequest,
  target: PersistTarget,
  prepared: PreparedExercise[],
): Promise<ImportLessonResult | ImportLessonError> {
  const tenantId = await getDefaultTenantId(req.payload)
  const lesson = await resolveLesson(req, target)
  if ('kind' in lesson) return lesson

  const appendMode = Boolean(target.targetLessonId)
  const orderStart = appendMode
    ? await nextOrder(req, 'exercises', { lesson: { equals: lesson.id } })
    : 0

  const results: ImportedExerciseResult[] = []
  const created: CreatedIds = { exercises: [], sections: [] }

  for (let i = 0; i < prepared.length; i++) {
    const ex = prepared[i]
    try {
      const outcome = await createExercise(req, lesson.id, orderStart + i, tenantId, ex, created)
      results.push(
        typeof outcome === 'string'
          ? { exerciseNumber: ex.exerciseNumber, error: outcome }
          : { exerciseNumber: ex.exerciseNumber, id: outcome.id },
      )
    } catch (err) {
      results.push({
        exerciseNumber: ex.exerciseNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    // Only delete the lesson if we CREATED it — in append-mode it pre-existed.
    await rollback(req, created, appendMode ? null : lesson.id)
    return {
      success: false,
      lessonId: appendMode ? lesson.id : '',
      lessonTitle: lesson.title,
      exercisesCreated: 0,
      exercisesFailed: failed.length,
      results,
    }
  }

  await writeLessonPlaylist(req, lesson, appendMode, created.exercises)

  return {
    success: true,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    exercisesCreated: results.filter((r) => r.id).length,
    exercisesFailed: 0,
    results,
  }
}
