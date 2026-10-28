/**
 * Build the lossless "full lesson JSON" export from already-fetched docs.
 * Blocks are copied verbatim; only the wrapper fields an author/LLM can
 * meaningfully edit are kept (no ids, tenant, slugs, timestamps).
 */
import {
  FULL_LESSON_FORMAT,
  FULL_LESSON_INSTRUCTIONS,
  FULL_LESSON_VERSION,
  type FullLessonExercise,
  type FullLessonFile,
  type FullLessonSection,
} from '@/infra/contracts/lesson-full-json/v1'

type Doc = Record<string, unknown>

function contentBlocks(doc: Doc): unknown[] {
  const content = doc.content as { blocks?: unknown[] } | undefined
  return Array.isArray(content?.blocks) ? content.blocks : []
}

/** Copy only keys whose value is set — keeps the file small for the LLM. */
function pickDefined<K extends string>(doc: Doc, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {}
  for (const key of keys) {
    const value = doc[key]
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}

const SECTION_FIELDS = ['exerciseType', 'mainSkill', 'subSkills', 'objective'] as const
const EXERCISE_FIELDS = ['subject', 'topic', 'showQuestionNumbering'] as const

function toSection(doc: Doc, index: number): FullLessonSection {
  return {
    title: (doc.title as string) || `סעיף ${index + 1}`,
    ...pickDefined(doc, SECTION_FIELDS),
    blocks: contentBlocks(doc),
  } as FullLessonSection
}

function toExercise(doc: Doc, sections: Doc[], index: number): FullLessonExercise {
  return {
    title: (doc.title as string) || `תרגיל ${index + 1}`,
    ...pickDefined(doc, EXERCISE_FIELDS),
    blocks: contentBlocks(doc),
    sections: sections.map(toSection),
  } as FullLessonExercise
}

export function buildFullLessonExport(
  lesson: Doc,
  exerciseDocs: Doc[],
  sectionsByExerciseId: Map<string, Doc[]>,
): FullLessonFile {
  const type = lesson.type as FullLessonFile['lesson']['type']
  return {
    format: FULL_LESSON_FORMAT,
    version: FULL_LESSON_VERSION,
    instructions: FULL_LESSON_INSTRUCTIONS,
    lesson: { title: (lesson.title as string) || 'שיעור', ...(type ? { type } : {}) },
    exercises: exerciseDocs.map((ex, i) =>
      toExercise(ex, sectionsByExerciseId.get(ex.id as string) ?? [], i),
    ),
  }
}
