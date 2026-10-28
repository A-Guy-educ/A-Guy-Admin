/**
 * Import a "full lesson JSON" file (see full-lesson-format.ts) — the inverse
 * of buildFullLessonExport. Every block is validated against the real
 * ContentBlockSchema before anything is written, and problems are reported
 * with a readable location ("exercise 2 › section 1 › block 3 …") so the
 * admin can paste them straight back to the LLM that edited the file.
 */
import type { PayloadRequest } from 'payload'
import type { z } from 'zod'

import { ContentBlockSchema } from '@/server/payload/collections/Exercises/schemas'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import { generateId } from '@/server/payload/collections/Exercises/types'
import {
  persistImportedExercises,
  type ImportLessonError,
  type ImportLessonResult,
  type LessonType,
  type PreparedExercise,
} from '@/server/services/lesson-import-persist/persist-imported-exercises'

import { FullLessonFileSchema, type FullLessonFile } from '@/infra/contracts/lesson-full-json/v1'

export interface ImportFullLessonInput {
  chapterId?: string
  targetLessonId?: string
  json: unknown
  /** Overrides the file's lesson.type for a newly-created lesson. */
  lessonType?: LessonType
}

type Issue = { path: string; message: string }

function formatZodIssues(location: string, error: z.ZodError): Issue[] {
  return error.issues.map((iss) => ({
    path: [location, ...iss.path.map(String)].filter(Boolean).join(' › '),
    message: iss.message,
  }))
}

/**
 * Validate a block list and give every block a fresh id — the file may carry
 * ids from another lesson (or none, for blocks the LLM added). Blocks are kept
 * exactly as written otherwise; zod defaults are not baked in.
 */
function prepareBlocks(raw: unknown[], location: string, issues: Issue[]): ContentBlock[] {
  return raw.map((block, idx) => {
    const withId =
      typeof block === 'object' && block !== null ? { ...block, id: generateId() } : block
    const blockType = (block as { type?: unknown } | null)?.type
    const label = `${location} › block ${idx + 1}${typeof blockType === 'string' ? ` (${blockType})` : ''}`
    const check = ContentBlockSchema.safeParse(withId)
    if (!check.success) issues.push(...formatZodIssues(label, check.error))
    return withId as ContentBlock
  })
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
  const prepared = prepareExercises(parsed.data, issues)
  if (issues.length > 0) return { kind: 'validation', issues }

  return persistImportedExercises(
    req,
    {
      chapterId: input.chapterId,
      targetLessonId: input.targetLessonId,
      lessonTitle: parsed.data.lesson.title,
      lessonType: input.lessonType ?? parsed.data.lesson.type,
    },
    prepared,
  )
}
