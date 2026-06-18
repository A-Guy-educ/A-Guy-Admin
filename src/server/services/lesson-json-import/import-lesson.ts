import type { PayloadRequest } from 'payload'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'

import { buildExerciseTitle, convertExerciseToBlocks } from './convert-exercise'
import { LessonJsonSchema, parseLessonOrderFromFilename } from './json-schema'

export interface ImportLessonInput {
  chapterId: string
  filename: string
  json: unknown
}

export interface ImportLessonExerciseResult {
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
  results: ImportLessonExerciseResult[]
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

async function resolveLessonOrder(
  req: PayloadRequest,
  chapterId: string,
  filename: string,
): Promise<number> {
  const parsed = parseLessonOrderFromFilename(filename)
  if (parsed > 0) return parsed

  // Filename didn't match the expected pattern. Append after the current max
  // order in this chapter so two unparseable files don't both land on `order: 0`.
  const existing = await req.payload.find({
    collection: 'lessons',
    where: { chapter: { equals: chapterId } },
    sort: '-order',
    limit: 1,
    depth: 0,
    req,
    overrideAccess: true,
  })
  const top = existing.docs[0] as { order?: number } | undefined
  return (top?.order ?? -1) + 1
}

export async function importLessonFromJson(
  req: PayloadRequest,
  input: ImportLessonInput,
): Promise<ImportLessonResult | ImportLessonError> {
  if (!req.user) {
    return { kind: 'not_found', message: 'Authenticated user required' }
  }

  const parsed = LessonJsonSchema.safeParse(input.json)
  if (!parsed.success) {
    return {
      kind: 'validation',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    }
  }
  const lessonJson = parsed.data

  const chapter = await req.payload.findByID({
    collection: 'chapters',
    id: input.chapterId,
    depth: 0,
    req,
    overrideAccess: false,
    user: req.user,
  })
  if (!chapter) {
    return { kind: 'not_found', message: 'Chapter not found' }
  }

  // We don't pass tenant on create — the tenantField beforeValidate hook
  // auto-populates from getDefaultTenantId (AGuy). Passing it ourselves keeps
  // tripping Payload's relationship validation on Exercises for reasons that
  // don't reproduce on Lessons; letting the hook own it is the only path that
  // works for both collections.

  const order = await resolveLessonOrder(req, input.chapterId, input.filename)

  const lessonData = {
    locale: 'he',
    chapter: input.chapterId,
    type: 'practice',
    title: lessonJson.topic,
    order,
    status: 'draft',
    isActive: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  const lesson = await req.payload.create({
    collection: 'lessons',
    data: lessonData,
    req,
    overrideAccess: false,
    user: req.user,
  })

  const exerciseResults: ImportLessonExerciseResult[] = []
  const createdExerciseIds: string[] = []

  for (let i = 0; i < lessonJson.exercises.length; i++) {
    const ex = lessonJson.exercises[i]
    try {
      const content = { blocks: convertExerciseToBlocks(ex) }
      const contentCheck = ContentSchema.safeParse(content)
      if (!contentCheck.success) {
        exerciseResults.push({
          exerciseNumber: ex.exercise_number,
          error: contentCheck.error.issues
            .map((iss) => `[${iss.path.join('.')}] ${iss.message}`)
            .join('; '),
        })
        continue
      }

      // Idempotency key scoped to (chapter, filename, exercise_number) so the
      // value stays stable across re-imports. Informational only until Stage 4
      // of the Exercises spec makes the field unique at the DB level.
      const idempotencyKey = `json-import:${input.chapterId}:${input.filename}:${ex.exercise_number}`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exerciseData = {
        locale: 'he',
        lesson: lesson.id,
        title: buildExerciseTitle(lessonJson.topic, ex),
        order: i,
        content,
        origin: 'import',
        idempotencyKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
      const created = await req.payload.create({
        collection: 'exercises',
        data: exerciseData,
        req,
        overrideAccess: false,
        user: req.user,
        // Suppress the per-exercise afterChange → addBlockToLesson hook. That
        // hook does a read-modify-write on lesson.blocks per exercise; even
        // when our loop awaits sequentially, 8 of those in a row race and
        // most appends get lost. We write the complete blocks array once at
        // the bottom of this function instead.
        context: { _skipBlockSync: true },
      })
      exerciseResults.push({ exerciseNumber: ex.exercise_number, id: created.id })
      createdExerciseIds.push(created.id)
    } catch (err) {
      exerciseResults.push({
        exerciseNumber: ex.exercise_number,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const failed = exerciseResults.filter((r) => r.error)

  // Manual rollback on any failure — Mongo transactions need replica-set config
  // we don't have. Without this, a partial import leaves a draft lesson with
  // some exercises and a confusing "success: false" response. Roll back so the
  // operator only sees clean state and can retry the file after fixing it.
  if (failed.length > 0) {
    for (const id of createdExerciseIds) {
      try {
        await req.payload.delete({ collection: 'exercises', id, req, overrideAccess: true })
      } catch {
        // best-effort — surfaced via error in results below
      }
    }
    try {
      await req.payload.delete({ collection: 'lessons', id: lesson.id, req, overrideAccess: true })
    } catch {
      // best-effort
    }
    return {
      success: false,
      lessonId: '',
      lessonTitle: lesson.title,
      exercisesCreated: 0,
      exercisesFailed: failed.length,
      results: exerciseResults,
    }
  }

  // Write the complete lesson.blocks playlist in one shot. Each exercise was
  // created with _skipBlockSync to suppress the per-create append hook (it
  // races on serial imports), so we own the final ordering here.
  const blocks = createdExerciseIds.map((exerciseId) => ({
    id: Math.random().toString(36).slice(2, 14),
    blockType: 'exerciseRef' as const,
    exercise: exerciseId,
  }))
  try {
    await req.payload.update({
      collection: 'lessons',
      id: lesson.id,
      data: { blocks: JSON.stringify(blocks) },
      req,
      overrideAccess: true,
      context: { _skipBlockSync: true },
    })
  } catch (err) {
    // The exercises exist and link back to the lesson via their `lesson` field;
    // the admin lesson view will still work because LessonBlocksField queries
    // exercises by lesson. Worst case is the playlist order isn't pre-set.
    // Logged here so we have a trace if it ever fires.
    // eslint-disable-next-line no-console
    console.error('[lesson-json-import] failed to write lesson.blocks playlist', err)
  }

  return {
    success: true,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    exercisesCreated: exerciseResults.filter((r) => r.id).length,
    exercisesFailed: 0,
    results: exerciseResults,
  }
}
