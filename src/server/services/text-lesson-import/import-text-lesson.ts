/**
 * Service for importing the curriculum-team's plain-text lesson format
 * (see parse-text.ts / parse-text-v2.ts for the format specs).
 *
 * Parsing + conversion happen here; the lesson/exercise/section writes and
 * rollback-on-any-failure live in the shared persistImportedExercises.
 */
import type { PayloadRequest } from 'payload'

import {
  persistImportedExercises,
  type ImportedExerciseResult,
  type ImportLessonError,
  type ImportLessonResult,
  type LessonType,
  type PreparedExercise,
} from '@/server/services/lesson-import-persist/persist-imported-exercises'
import type { ContentBlock } from '@/server/payload/collections/Exercises/types'
import {
  lessonDetailsFromLabels,
  type LessonDetails,
} from '@/server/services/lesson-details-transfer/lesson-details-fields'
import type { LessonSectionsText } from '@/server/services/lesson-details-transfer/lesson-sections-text'
import {
  prepareImportedBlocks,
  type ImportIssue,
} from '@/server/services/lesson-full-json/prepare-imported-blocks'

import {
  buildTextExerciseTitle,
  convertTextExerciseToSections,
  deriveLessonTitle,
} from './convert-text-exercise'
import { buildV2ExerciseTitle, convertTextExerciseV2ToSections } from './convert-text-exercise-v2'
import { parseTextLesson } from './parse-text'
import { isV2Format, parseTextLessonV2 } from './parse-text-v2'

export type { LessonType }
export type ImportTextExerciseResult = ImportedExerciseResult
export type ImportTextLessonResult = ImportLessonResult
export type ImportTextLessonError = ImportLessonError

export interface ImportTextLessonInput {
  /** Required when creating a NEW lesson. Ignored when `targetLessonId` is set. */
  chapterId?: string
  /**
   * When set, append the imported exercises to this existing lesson instead
   * of creating a new one. The lesson's chapter/title/order aren't touched.
   */
  targetLessonId?: string
  filename: string
  text: string
  /** Lesson.type for newly-created lessons. Ignored in append-mode. */
  lessonType?: LessonType
}

interface PreparedTextLesson {
  exercises: PreparedExercise[]
  lessonDetails: LessonDetails
  lessonBlocks: ContentBlock[]
  issues: ImportIssue[]
}

/** The `[ בלוקים של השיעור ]` JSON → validated blocks (problems go onto `issues`). */
function prepareLessonBlocks(sections: LessonSectionsText, issues: ImportIssue[]): ContentBlock[] {
  if (!sections.blocksJson) return []
  let raw: unknown
  try {
    raw = JSON.parse(sections.blocksJson)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'invalid JSON'
    issues.push({ path: 'בלוקים של השיעור', message: `Not valid JSON: ${reason}` })
    return []
  }
  if (!Array.isArray(raw)) {
    issues.push({ path: 'בלוקים של השיעור', message: 'Expected a JSON array of blocks' })
    return []
  }
  return prepareImportedBlocks(raw, 'בלוקים של השיעור', issues)
}

/**
 * Route between the legacy `תרגיל N – מנחה: subtopic` format and the v2
 * bracketed / geometry-aware format based on a signature check. Both paths
 * converge on the same prepared-exercise shape; only v2 carries lesson
 * fields/blocks.
 */
function prepareLesson(text: string): PreparedTextLesson {
  if (isV2Format(text)) {
    const parsed = parseTextLessonV2(text)
    const issues: ImportIssue[] = []
    return {
      exercises: parsed.exercises.map((ex) => {
        const converted = convertTextExerciseV2ToSections(ex)
        return {
          exerciseNumber: ex.exerciseNumber,
          title: buildV2ExerciseTitle(ex),
          ...converted,
        }
      }),
      lessonDetails: lessonDetailsFromLabels(parsed.lessonSections.detailsByLabel),
      lessonBlocks: prepareLessonBlocks(parsed.lessonSections, issues),
      issues,
    }
  }
  const exercises = parseTextLesson(text).exercises.map((ex) => {
    const converted = convertTextExerciseToSections(ex)
    return {
      exerciseNumber: ex.exerciseNumber,
      title: buildTextExerciseTitle(ex),
      ...converted,
    }
  })
  return { exercises, lessonDetails: {}, lessonBlocks: [], issues: [] }
}

export async function importTextLessonFromFile(
  req: PayloadRequest,
  input: ImportTextLessonInput,
): Promise<ImportTextLessonResult | ImportTextLessonError> {
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

  const { exercises: prepared, lessonDetails, lessonBlocks, issues } = prepareLesson(input.text)
  if (issues.length > 0) return { kind: 'validation', issues }
  if (prepared.length === 0) {
    return {
      kind: 'validation',
      issues: [{ path: 'exercises', message: 'No exercises found in the file' }],
    }
  }

  return persistImportedExercises(
    req,
    {
      chapterId: input.chapterId,
      targetLessonId: input.targetLessonId,
      lessonTitle: deriveLessonTitle({ filename: input.filename }),
      lessonType: input.lessonType,
      lessonDetails,
      lessonBlocks,
    },
    prepared,
  )
}
