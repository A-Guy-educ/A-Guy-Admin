/**
 * Service for importing the curriculum-team's plain-text lesson format
 * (see parse-text.ts for the format spec).
 *
 * Mirrors the structure of `lesson-json-import/import-lesson.ts` — one draft
 * Lesson per file, one Exercise per `תרגיל`, manual rollback on any failure,
 * single lesson.blocks write at the end so the per-exercise afterChange hook
 * doesn't race.
 */
import type { PayloadRequest } from 'payload'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { generateId } from '@/server/payload/collections/Exercises/types'
import { getDefaultTenantId } from '@/server/repos/tenant/get-default-tenant'

import {
  buildTextExerciseTitle,
  convertTextExerciseToSections,
  deriveLessonTitle,
} from './convert-text-exercise'
import { parseTextLesson } from './parse-text'

export interface ImportTextLessonInput {
  chapterId: string
  filename: string
  text: string
}

export interface ImportTextExerciseResult {
  exerciseNumber: string
  id?: string
  error?: string
}

export interface ImportTextLessonResult {
  success: boolean
  lessonId: string
  lessonTitle: string
  exercisesCreated: number
  exercisesFailed: number
  results: ImportTextExerciseResult[]
}

export interface ImportTextLessonValidationError {
  kind: 'validation'
  issues: Array<{ path: string; message: string }>
}

export interface ImportTextLessonNotFoundError {
  kind: 'not_found'
  message: string
}

export type ImportTextLessonError = ImportTextLessonValidationError | ImportTextLessonNotFoundError

function emptyRichTextPlaceholder() {
  return {
    id: generateId(),
    type: 'rich_text' as const,
    format: 'md-math-v1' as const,
    value: '',
    mediaIds: [],
  }
}

async function resolveLessonOrder(req: PayloadRequest, chapterId: string): Promise<number> {
  // The text format doesn't carry a per-lesson order on the filename pattern
  // we know about, so just append after the current max in the chapter.
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

export async function importTextLessonFromFile(
  req: PayloadRequest,
  input: ImportTextLessonInput,
): Promise<ImportTextLessonResult | ImportTextLessonError> {
  if (!req.user) {
    return { kind: 'not_found', message: 'Authenticated user required' }
  }

  const parsed = parseTextLesson(input.text)
  if (parsed.exercises.length === 0) {
    return {
      kind: 'validation',
      issues: [{ path: 'exercises', message: 'No exercises found in the file' }],
    }
  }

  const chapter = await req.payload.findByID({
    collection: 'chapters',
    id: input.chapterId,
    depth: 0,
    req,
    overrideAccess: false,
    user: req.user,
  })
  if (!chapter) return { kind: 'not_found', message: 'Chapter not found' }

  const tenantId = await getDefaultTenantId(req.payload)

  const lessonTitle = deriveLessonTitle({
    lessonName: parsed.lessonName,
    filename: input.filename,
    firstExerciseSubtopic: parsed.exercises[0]?.subtopic,
  })
  const order = await resolveLessonOrder(req, input.chapterId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lessonData = {
    locale: 'he',
    chapter: input.chapterId,
    type: 'practice',
    title: lessonTitle,
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

  const exerciseResults: ImportTextExerciseResult[] = []
  const createdExerciseIds: string[] = []
  const createdSectionIds: string[] = []

  for (let i = 0; i < parsed.exercises.length; i++) {
    const ex = parsed.exercises[i]
    try {
      const converted = convertTextExerciseToSections(ex)
      const content = {
        blocks:
          converted.sharedBlocks.length > 0 ? converted.sharedBlocks : [emptyRichTextPlaceholder()],
      }
      const check = ContentSchema.safeParse(content)
      if (!check.success) {
        exerciseResults.push({
          exerciseNumber: ex.exerciseNumber,
          error: check.error.issues
            .map((iss) => `[${iss.path.join('.')}] ${iss.message}`)
            .join('; '),
        })
        continue
      }

      let sectionValidationError: string | undefined
      for (let sIdx = 0; sIdx < converted.sections.length; sIdx++) {
        const sectionCheck = ContentSchema.safeParse({ blocks: converted.sections[sIdx].blocks })
        if (!sectionCheck.success) {
          sectionValidationError = `Section ${sIdx + 1}: ${sectionCheck.error.issues
            .map((iss) => `[${iss.path.join('.')}] ${iss.message}`)
            .join('; ')}`
          break
        }
      }
      if (sectionValidationError) {
        exerciseResults.push({
          exerciseNumber: ex.exerciseNumber,
          error: sectionValidationError,
        })
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exerciseData = {
        locale: 'he',
        lesson: lesson.id,
        title: buildTextExerciseTitle(ex),
        order: i,
        content,
        origin: 'import',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
      const created = await req.payload.create({
        collection: 'exercises',
        data: exerciseData,
        req,
        overrideAccess: true,
        user: req.user,
        context: { _skipBlockSync: true },
      })
      createdExerciseIds.push(created.id)

      const sectionIds: string[] = []
      for (let sIdx = 0; sIdx < converted.sections.length; sIdx++) {
        const section = converted.sections[sIdx]
        const sectionContent = { blocks: section.blocks }
        const createdSection = await req.payload.create({
          collection: 'sections',
          data: {
            tenant: tenantId,
            locale: 'he',
            title: section.title,
            exercise: created.id,
            order: sIdx,
            exerciseType: 'basic',
            content: sectionContent,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          req,
          overrideAccess: true,
          user: req.user,
          context: { _skipExerciseBlockSync: true },
        })
        sectionIds.push(createdSection.id)
        createdSectionIds.push(createdSection.id)
      }

      const exerciseBlocksPlaylist = sectionIds.map((id) => ({
        id: Math.random().toString(36).slice(2, 14),
        blockType: 'sectionRef' as const,
        section: id,
      }))
      await req.payload.update({
        collection: 'exercises',
        id: created.id,
        data: { blocks: JSON.stringify(exerciseBlocksPlaylist) },
        req,
        overrideAccess: true,
        context: { _skipExerciseBlockSync: true },
      })

      exerciseResults.push({ exerciseNumber: ex.exerciseNumber, id: created.id })
    } catch (err) {
      exerciseResults.push({
        exerciseNumber: ex.exerciseNumber,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const failed = exerciseResults.filter((r) => r.error)

  if (failed.length > 0) {
    for (const id of createdSectionIds) {
      try {
        await req.payload.delete({ collection: 'sections', id, req, overrideAccess: true })
      } catch {
        /* best-effort */
      }
    }
    for (const id of createdExerciseIds) {
      try {
        await req.payload.delete({ collection: 'exercises', id, req, overrideAccess: true })
      } catch {
        /* best-effort */
      }
    }
    try {
      await req.payload.delete({ collection: 'lessons', id: lesson.id, req, overrideAccess: true })
    } catch {
      /* best-effort */
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

  // Single lesson.blocks playlist write — see JSON importer for the rationale.
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
    // eslint-disable-next-line no-console
    console.error('[text-lesson-import] failed to write lesson.blocks playlist', err)
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
