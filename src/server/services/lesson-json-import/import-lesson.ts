import type { Payload, User } from 'payload'

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

export async function importLessonFromJson(
  payload: Payload,
  user: User,
  input: ImportLessonInput,
): Promise<ImportLessonResult | ImportLessonError> {
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

  const chapter = await payload.findByID({
    collection: 'chapters',
    id: input.chapterId,
    depth: 0,
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
        : await getDefaultTenantId(payload)

  const order = parseLessonOrderFromFilename(input.filename)

  const lesson = await payload.create({
    collection: 'lessons',
    data: {
      tenant: tenantId,
      locale: 'he',
      chapter: input.chapterId,
      type: 'practice',
      title: lessonJson.topic,
      order,
      status: 'draft',
      isActive: true,
    },
    overrideAccess: false,
    user,
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

      const created = await payload.create({
        collection: 'exercises',
        data: {
          tenant: tenantId,
          locale: 'he',
          lesson: lesson.id,
          title: buildExerciseTitle(lessonJson.topic, ex),
          order: i,
          content,
          origin: 'import',
          idempotencyKey: `json-import:${lesson.id}:${ex.exercise_number}`,
        },
        overrideAccess: false,
        user,
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
