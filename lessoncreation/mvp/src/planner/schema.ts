/**
 * Zod schema for the planner's output — a lesson skeleton, NOT the final
 * exercise text. The skeleton mirrors format.md's "דגשים" structure:
 *
 *   - Lesson-level objective + prior-knowledge assumption
 *   - 10 exercises, each with:
 *       objective    — what this exercise teaches
 *       oneNewThing  — the single incremental concept vs the previous one
 *       sections     — 4 sub-parts (א/ב/ג/ד): question shape + expected discovery
 *
 * The critic stage grades this. The writer stage materializes it into v2
 * `.txt`. Keeping it JSON at this stage means:
 *   - the model can't dodge structure by writing prose,
 *   - the critic has stable fields to check against flow.md's rules,
 *   - the human reviewer can eyeball a 10-line summary before we spend on writing.
 */
import { z } from 'zod'

const HEBREW_LETTERS = ['א', 'ב', 'ג', 'ד'] as const

export const SectionShape = z.enum([
  'mcq-2', // בחירה בין 2 אפשרויות
  'mcq-3', // בחירה בין 3 אפשרויות
  'free-response', // תשובה פתוחה
])

export const SectionPlan = z.object({
  letter: z.enum(HEBREW_LETTERS).describe('The Hebrew section letter (א/ב/ג/ד).'),
  shape: SectionShape.describe(
    'Question shape as required by format.md: mcq-2 for א/ב, mcq-3 for ג, free-response for ד.',
  ),
  briefPrompt: z
    .string()
    .min(5)
    .describe(
      'A one-sentence Hebrew description of what the student is asked in this sub-section — not the full question, just the essence. The writer will expand it.',
    ),
  expectedDiscovery: z
    .string()
    .min(5)
    .describe('One-sentence Hebrew: what the student is supposed to notice/understand from this section.'),
})

export const ExercisePlan = z.object({
  number: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe('Exercise number 1-10, in learning-sequence order.'),
  objective: z
    .string()
    .min(5)
    .describe('One Hebrew sentence — the pedagogical goal of this exercise.'),
  oneNewThing: z
    .string()
    .min(5)
    .describe(
      'One Hebrew sentence — the single new concept this exercise adds vs the previous one. For exercise 1, describe the entry-point concept.',
    ),
  visualStyle: z
    .string()
    .describe(
      'Free Hebrew text describing the visual context (SVG/diagram idea) if any. Empty string when purely textual.',
    ),
  sections: z
    .array(SectionPlan)
    .length(4)
    .describe('Exactly 4 sub-sections, in order א/ב/ג/ד with shapes mcq-2, mcq-2, mcq-3, free-response.'),
})

export const LessonSkeleton = z.object({
  lessonName: z.string().min(2).describe('Hebrew lesson title as given.'),
  course: z.string().min(2).describe('Grade / course.'),
  chapter: z.string().min(2).describe('Chapter within the course.'),
  lessonObjective: z
    .string()
    .min(10)
    .describe('One paragraph Hebrew — what a student who completes this lesson knows/can do.'),
  priorKnowledgeKnown: z
    .string()
    .describe(
      'Hebrew — what the student ALREADY KNOWS at the start of the lesson (skills, concepts, notation). Multi-line bullet-style is fine. Never empty for grade 10+ topics — assume real prior knowledge.',
    ),
  priorKnowledgeAssumeNot: z
    .string()
    .describe(
      'Hebrew — what to explicitly NOT assume the student knows (concepts that will be introduced by this lesson or a later one). Prevents pedagogical jumps.',
    ),
  lessonBoundaries: z
    .string()
    .describe(
      'Hebrew — what this lesson does NOT teach (out of scope). Prevents topic drift into adjacent or advanced material. Multi-line bullet-style is fine.',
    ),
  exercises: z.array(ExercisePlan).length(10).describe('Exactly 10 exercises in learning order.'),
})

export type LessonSkeleton = z.infer<typeof LessonSkeleton>
export type ExercisePlan = z.infer<typeof ExercisePlan>
export type SectionPlan = z.infer<typeof SectionPlan>
