/**
 * Import a "full lesson JSON" file (see full-lesson-format.ts) — the inverse
 * of buildFullLessonExport. Every block is validated against the real
 * ContentBlockSchema before anything is written, and problems are reported
 * with a readable location ("exercise 2 › section 1 › block 3 …") so the
 * admin can paste them straight back to the LLM that edited the file.
 */
import type { PayloadRequest } from 'payload'

import {
  persistImportedExercises,
  type ImportLessonError,
  type ImportLessonResult,
  type LessonType,
  type PreparedExercise,
} from '@/server/services/lesson-import-persist/persist-imported-exercises'
import { pickLessonDetails } from '@/server/services/lesson-details-transfer/lesson-details-fields'

import { FullLessonFileSchema, type FullLessonFile } from '@/infra/contracts/lesson-full-json/v1'

import {
  formatZodIssues,
  prepareImportedBlocks as prepareBlocks,
  type ImportIssue as Issue,
} from './prepare-imported-blocks'

export interface ImportFullLessonInput {
  chapterId?: string
  targetLessonId?: string
  json: unknown
  /** Overrides the file's lesson.type for a newly-created lesson. */
  lessonType?: LessonType
}

function prepareExercises(file: FullLessonFile, issues: Issue[]): PreparedExercise[] {
  return file.exercises.map((ex, exIdx) => {
    const exLocation = `exercise ${exIdx + 1}`
    const { title, blocks, sections, ...exerciseFields } = ex
    return {
      exerciseNumber: String(exIdx + 1),
      title,
      sharedBlocks: prepareBlocks(blocks, exLocation, issues),
      fields: exerciseFields,
      sections: sections.map((section, sIdx) => {
        const { title: sectionTitle, blocks: sectionBlocks, ...sectionFields } = section
        return {
          title: sectionTitle,
          blocks: prepareBlocks(sectionBlocks, `${exLocation} › section ${sIdx + 1}`, issues),
          fields: sectionFields,
        }
      }),
    }
  })
}

export async function importFullLessonJson(
  req: PayloadRequest,
  input: ImportFullLessonInput,
): Promise<ImportLessonResult | ImportLessonError> {
  if (!req.user) return { kind: 'not_found', message: 'Authenticated user required' }
  if (!input.chapterId && !input.targetLessonId) {
    return {
      kind: 'validation',
      issues: [{ path: 'chapterId', message: 'Either chapterId or targetLessonId is required' }],
    }
  }

  const parsed = FullLessonFileSchema.safeParse(input.json)
  if (!parsed.success) {
    return { kind: 'validation', issues: formatZodIssues('', parsed.error) }
  }

  const issues: Issue[] = []
  const lessonBlocks = prepareBlocks(parsed.data.lesson.blocks, 'lesson', issues)
  const prepared = prepareExercises(parsed.data, issues)
  if (issues.length > 0) return { kind: 'validation', issues }

  return persistImportedExercises(
    req,
    {
      chapterId: input.chapterId,
      targetLessonId: input.targetLessonId,
      lessonTitle: parsed.data.lesson.title,
      lessonType: input.lessonType ?? parsed.data.lesson.type,
      lessonDetails: pickLessonDetails(parsed.data.lesson),
      lessonBlocks,
    },
    prepared,
  )
}
