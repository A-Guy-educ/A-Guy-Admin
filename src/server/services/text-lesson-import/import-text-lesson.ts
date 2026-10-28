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

/**
 * Route between the legacy `תרגיל N – מנחה: subtopic` format and the v2
 * bracketed / geometry-aware format based on a signature check. Both paths
 * converge on the same prepared-exercise shape.
 */
function prepareExercises(text: string): PreparedExercise[] {
  if (isV2Format(text)) {
    return parseTextLessonV2(text).exercises.map((ex) => {
      const converted = convertTextExerciseV2ToSections(ex)
      return {
        exerciseNumber: ex.exerciseNumber,
        title: buildV2ExerciseTitle(ex),
        ...converted,
      }
    })
  }
  return parseTextLesson(text).exercises.map((ex) => {
    const converted = convertTextExerciseToSections(ex)
    return {
      exerciseNumber: ex.exerciseNumber,
      title: buildTextExerciseTitle(ex),
      ...converted,
    }
  })
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

  const prepared = prepareExercises(input.text)
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
    },
    prepared,
  )
}
