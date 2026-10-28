/**
 * "Full lesson JSON" — a lossless export of a lesson exactly as stored
 * (every exercise, section and content block, with all answers, graphics and
 * display settings). Meant to be edited by an LLM (ChatGPT / Gemini) and
 * imported back. The block shapes are the Exercises `ContentBlockSchema`;
 * this file only defines the wrapper. Zod-only so the import page's client
 * preview can use it too.
 */
import { z } from 'zod'

export const FULL_LESSON_FORMAT = 'aguy-lesson-full'
export const FULL_LESSON_VERSION = 1

/** Read by the LLM editing the file — keep it short and rule-focused. */
export const FULL_LESSON_INSTRUCTIONS = [
  'Complete A-Guy lesson export. Edit it, then import the whole file back.',
  'Keep "format" and "version" unchanged.',
  'Each exercise has "blocks" (shown above its sections) and "sections"; every section needs at least one block.',
  'Keep every block\'s "type" and required fields; do not invent block types or field names. New blocks may omit "id".',
  'Text values are Markdown with LaTeX math ($...$ inline, $$...$$ display).',
  'question_select (mcq): every id in answer.correctOptionIds must match an option id; single-select has exactly one.',
  'media blocks and "mediaIds" point at uploaded files — never invent those ids.',
].join(' ')

const SectionSchema = z.object({
  title: z.string().min(1),
  exerciseType: z.string().optional(),
  mainSkill: z.string().nullable().optional(),
  subSkills: z.array(z.string()).nullable().optional(),
  objective: z.string().nullable().optional(),
  // Block shapes are validated one by one in the importer for precise paths.
  blocks: z.array(z.unknown()).min(1, 'a section needs at least one block'),
})

const ExerciseSchema = z.object({
  title: z.string().min(1),
  subject: z.string().nullable().optional(),
  topic: z.string().nullable().optional(),
  showQuestionNumbering: z.boolean().nullable().optional(),
  blocks: z.array(z.unknown()).default([]),
  sections: z.array(SectionSchema).default([]),
})

export const FullLessonFileSchema = z.object({
  format: z.literal(FULL_LESSON_FORMAT),
  version: z.literal(FULL_LESSON_VERSION),
  instructions: z.string().optional(),
  lesson: z.object({
    title: z.string().min(1),
    type: z.enum(['learning', 'practice', 'exam']).optional(),
  }),
  exercises: z.array(ExerciseSchema).min(1, 'the file has no exercises'),
})

export type FullLessonFile = z.infer<typeof FullLessonFileSchema>
export type FullLessonExercise = FullLessonFile['exercises'][number]
export type FullLessonSection = FullLessonExercise['sections'][number]

/** Cheap shape sniff used to route a `.json` upload to the full-lesson importer. */
export function isFullLessonJson(json: unknown): boolean {
  return (
    typeof json === 'object' &&
    json !== null &&
    (json as { format?: unknown }).format === FULL_LESSON_FORMAT
  )
}
