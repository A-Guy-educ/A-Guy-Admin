import type { PayloadRequest } from 'payload'

import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { generateId } from '@/server/payload/collections/Exercises/types'
import { getDefaultTenantId } from '@/server/repos/tenant/get-default-tenant'

import { buildExerciseTitle, convertExerciseToSections } from './convert-exercise'
import { LessonJsonSchema, parseLessonOrderFromFilename } from './json-schema'

export interface ImportLessonInput {
  /** Required when creating a NEW lesson. Ignored when `targetLessonId` is set. */
  chapterId?: string
  /**
   * When set, append the imported exercises to this existing lesson instead
   * of creating a new one. The lesson's chapter/title/order aren't touched;
   * only new Exercise + Section docs are created and appended to the
   * lesson.blocks playlist.
   */
  targetLessonId?: string
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

function emptyRichTextPlaceholder() {
  return {
    id: generateId(),
    type: 'rich_text' as const,
    format: 'md-math-v1' as const,
    value: '',
    mediaIds: [],
  }
}

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

async function nextExerciseOrder(req: PayloadRequest, lessonId: string): Promise<number> {
  const existing = await req.payload.find({
    collection: 'exercises',
    where: { lesson: { equals: lessonId } },
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

  if (!input.chapterId && !input.targetLessonId) {
    return {
      kind: 'validation',
      issues: [
        {
          path: 'chapterId',
          message: 'Either chapterId (create new lesson) or targetLessonId (append) is required',
        },
      ],
    }
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

  const tenantId = await getDefaultTenantId(req.payload)

  // Resolve the target lesson — create fresh or look up existing. Gate rollback
  // via `didCreateLesson` so an append-mode failure doesn't delete a
  // pre-existing lesson with other content.
  let lesson: { id: string; title: string; existingBlocks: Array<Record<string, unknown>> }
  const didCreateLesson = !input.targetLessonId

  if (input.targetLessonId) {
    const existing = await req.payload.findByID({
      collection: 'lessons',
      id: input.targetLessonId,
      depth: 0,
      req,
      overrideAccess: false,
      user: req.user,
    })
    if (!existing) return { kind: 'not_found', message: 'Lesson not found' }
    lesson = {
      id: existing.id,
      title: (existing as { title?: string }).title ?? '',
      existingBlocks: parseExistingBlocks((existing as { blocks?: unknown }).blocks),
    }
  } else {
    const chapterId = input.chapterId as string
    const chapter = await req.payload.findByID({
      collection: 'chapters',
      id: chapterId,
      depth: 0,
      req,
      overrideAccess: false,
      user: req.user,
    })
    if (!chapter) {
      return { kind: 'not_found', message: 'Chapter not found' }
    }
    const order = await resolveLessonOrder(req, chapterId, input.filename)
    const lessonData = {
      tenant: tenantId,
      locale: 'he',
      chapter: chapterId,
      type: 'practice',
      title: lessonJson.topic,
      order,
      status: 'draft',
      isActive: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const created = await req.payload.create({
      collection: 'lessons',
      data: lessonData,
      req,
      overrideAccess: false,
      user: req.user,
    })
    lesson = { id: created.id, title: created.title, existingBlocks: [] }
  }

  // Order offset: append-mode starts after the current max in the lesson so
  // the new exercises don't collide with existing order values.
  const orderStart = input.targetLessonId ? await nextExerciseOrder(req, lesson.id) : 0

  const exerciseResults: ImportLessonExerciseResult[] = []
  const createdExerciseIds: string[] = []
  const createdSectionIds: string[] = []

  for (let i = 0; i < lessonJson.exercises.length; i++) {
    const ex = lessonJson.exercises[i]
    try {
      const converted = convertExerciseToSections(ex)
      const content = {
        blocks:
          converted.sharedBlocks.length > 0 ? converted.sharedBlocks : [emptyRichTextPlaceholder()],
      }
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
          exerciseNumber: ex.exercise_number,
          error: sectionValidationError,
        })
        continue
      }

      // We deliberately do NOT write `idempotencyKey`. The field config comments
      // it as "non-unique until Stage 4", but the DB has a unique compound index
      // on (tenant, idempotencyKey). A stable key here means every re-import of
      // the same file collides, and the Mongo adapter maps the 11000 error to
      // "field invalid: tenant" (it extracts the first field name from the
      // compound index, which is misleading). Until Stage 4 lands a real
      // dedup/upsert story, we just let each import create fresh rows.

      const exerciseData = {
        tenant: tenantId,
        locale: 'he',
        lesson: lesson.id,
        title: buildExerciseTitle(lessonJson.topic, ex),
        order: orderStart + i,
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
        // Suppress the per-exercise afterChange → addBlockToLesson hook. That
        // hook does a read-modify-write on lesson.blocks per exercise; even
        // when our loop awaits sequentially, 8 of those in a row race and
        // most appends get lost. We write the complete blocks array once at
        // the bottom of this function instead.
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

      exerciseResults.push({ exerciseNumber: ex.exercise_number, id: created.id })
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
  //
  // Append-mode: only delete what THIS import created; never touch the
  // pre-existing lesson or its unrelated exercises.
  if (failed.length > 0) {
    for (const id of createdSectionIds) {
      try {
        await req.payload.delete({ collection: 'sections', id, req, overrideAccess: true })
      } catch {
        // best-effort — surfaced via error in results below
      }
    }
    for (const id of createdExerciseIds) {
      try {
        await req.payload.delete({ collection: 'exercises', id, req, overrideAccess: true })
      } catch {
        // best-effort — surfaced via error in results below
      }
    }
    if (didCreateLesson) {
      try {
        await req.payload.delete({
          collection: 'lessons',
          id: lesson.id,
          req,
          overrideAccess: true,
        })
      } catch {
        // best-effort
      }
    }
    return {
      success: false,
      lessonId: didCreateLesson ? '' : lesson.id,
      lessonTitle: lesson.title,
      exercisesCreated: 0,
      exercisesFailed: failed.length,
      results: exerciseResults,
    }
  }

  // Write the complete lesson.blocks playlist in one shot. Each exercise was
  // created with _skipBlockSync to suppress the per-create append hook (it
  // races on serial imports), so we own the final ordering here. Append-mode
  // preserves the existing playlist and appends the new refs at the end.
  //
  // Race narrowing: in append-mode, re-read lesson.blocks immediately before
  // the write so anything an addBlockToLesson hook or concurrent import wrote
  // during our multi-second create loop still lands in the final playlist.
  // The mount-time snapshot on `lesson.existingBlocks` could be minutes stale.
  const newBlocks = createdExerciseIds.map((exerciseId) => ({
    id: Math.random().toString(36).slice(2, 14),
    blockType: 'exerciseRef' as const,
    exercise: exerciseId,
  }))
  let baseBlocks = lesson.existingBlocks
  if (!didCreateLesson) {
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
      // Best-effort — if the re-read fails, fall back to the mount-time
      // snapshot rather than lose the new exerciseRefs entirely.
      console.error('[lesson-json-import] failed to re-read lesson.blocks; using snapshot', err)
    }
  }
  const finalBlocks = [...baseBlocks, ...newBlocks]
  try {
    await req.payload.update({
      collection: 'lessons',
      id: lesson.id,
      data: { blocks: JSON.stringify(finalBlocks) },
      req,
      overrideAccess: true,
      context: { _skipBlockSync: true },
    })
  } catch (err) {
    // The exercises exist and link back to the lesson via their `lesson` field;
    // the admin lesson view will still work because LessonBlocksField queries
    // exercises by lesson. Worst case is the playlist order isn't pre-set.
    // Logged here so we have a trace if it ever fires.

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
