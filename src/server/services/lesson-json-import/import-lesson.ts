import type { PayloadRequest } from 'payload'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { getDefaultTenantId } from '@/server/repos/tenant/get-default-tenant'

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

  const chapterTenant = (chapter as { tenant?: string | { id: string } }).tenant
  const tenantId =
    typeof chapterTenant === 'string'
      ? chapterTenant
      : chapterTenant && typeof chapterTenant === 'object'
        ? chapterTenant.id
        : await getDefaultTenantId(req.payload)

  const order = await resolveLessonOrder(req, input.chapterId, input.filename)

  const lessonData = {
    tenant: tenantId,
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

      // Idempotency key scoped to (chapter, filename, exercise_number) so that
      // re-importing the same file into the same chapter produces a stable
      // identity for each exercise — even though a fresh lesson row is created
      // each time. Currently informational only; the field is non-unique at the
      // DB level until Stage 4 of the Exercises spec.
      const idempotencyKey = `json-import:${input.chapterId}:${input.filename}:${ex.exercise_number}`

      const created = await req.payload.create({
        collection: 'exercises',
        data: {
          tenant: tenantId,
          locale: 'he',
          lesson: lesson.id,
          title: buildExerciseTitle(lessonJson.topic, ex),
          order: i,
          content,
          origin: 'import',
          idempotencyKey,
        },
        req,
        overrideAccess: false,
        user: req.user,
      })
      exerciseResults.push({ exerciseNumber: ex.exercise_number, id: created.id })
    } catch (err) {
      exerciseResults.push({
        exerciseNumber: ex.exercise_number,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const failed = exerciseResults.filter((r) => r.error)
  return {
    success: failed.length === 0,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    exercisesCreated: exerciseResults.filter((r) => r.id).length,
    exercisesFailed: failed.length,
    results: exerciseResults,
  }
}
