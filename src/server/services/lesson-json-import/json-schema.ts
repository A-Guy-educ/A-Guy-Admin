import { z } from 'zod'

const ContentBlockSchema = z
  .object({
    text: z.string(),
    table: z
      .object({
        headers: z.array(z.string()),
        rows_data: z.array(z.array(z.string())),
      })
      .optional(),
    PNG: z.string().optional(),
    svg: z.string().optional(),
  })
  .passthrough()

const SectionSchema = z
  .object({
    section_data: ContentBlockSchema.optional(),
    question_number: z.string().optional(),
    question: ContentBlockSchema,
    hint: ContentBlockSchema.optional(),
    solution: ContentBlockSchema.optional(),
    full_solution: ContentBlockSchema.optional(),
    correct_option: ContentBlockSchema,
    wrong_options: z.array(ContentBlockSchema).min(1),
  })
  .passthrough()

const ExerciseSchema = z
  .object({
    exercise_number: z.union([z.string(), z.number()]).transform((v) => String(v)),
    level: z.union([z.string(), z.number()]).optional(),
    topic: z.string().optional(),
    exercise_content: z.object({
      data: ContentBlockSchema.optional(),
      sections: z.array(SectionSchema).min(1),
    }),
  })
  .passthrough()

export const LessonJsonSchema = z
  .object({
    class: z.string().optional(),
    lesson_number: z.union([z.string(), z.number()]).optional(),
    topic: z.string().min(1, 'Top-level "topic" is required'),
    exercises: z.array(ExerciseSchema).min(1, 'Lesson must contain at least one exercise'),
  })
  .passthrough()

export type LessonJson = z.infer<typeof LessonJsonSchema>
export type LessonJsonExercise = z.infer<typeof ExerciseSchema>
export type LessonJsonSection = z.infer<typeof SectionSchema>
export type LessonJsonContentBlock = z.infer<typeof ContentBlockSchema>

const FILENAME_LESSON_NUMBER_RE = /שיעור\s*(\d+)/

export function parseLessonOrderFromFilename(filename: string): number {
  const match = filename.match(FILENAME_LESSON_NUMBER_RE)
  if (match) return Number(match[1])
  return 0
}
