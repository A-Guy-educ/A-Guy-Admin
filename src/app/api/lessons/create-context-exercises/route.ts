/**
 * Create Exercises from Context API
 *
 * POST /api/lessons/create-context-exercises
 * Parses lessonContextText into individual exercises and creates Exercise
 * documents with LaTeX blocks for each one.
 *
 * Idempotent: deletes previous context_extraction exercises before creating new ones.
 */
import { apiError, apiSuccess } from '@/server/api/responses'
import { withApiHandler } from '@/server/api/with-api-handler'
import { parseContextText } from '@/lib/context-exercise-parser'
import { makeLatexBlock } from '@/lib/latex-parser/block-generators'
import type { Lesson } from '@/payload-types'
import { z } from 'zod'

const createContextExercisesSchema = z.object({
  lessonId: z.string().min(1, 'lessonId is required'),
})

type CreateContextExercisesBody = z.infer<typeof createContextExercisesSchema>

export const POST = withApiHandler<CreateContextExercisesBody, unknown>(
  {
    auth: 'admin',
    bodySchema: createContextExercisesSchema,
  },
  async ({ payload, user, body }) => {
    const { lessonId } = body

    // Fetch lesson and read lessonContextText
    let lesson: Lesson
    try {
      lesson = (await payload.findByID({
        collection: 'lessons',
        id: lessonId,
        depth: 0,
        user: user!,
        overrideAccess: false,
      })) as unknown as Lesson
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('not found') || message.includes('Not Found')) {
        return apiError('LESSON_NOT_FOUND', 'Lesson not found', 404)
      }
      throw err
    }

    const lessonContextText = lesson.lessonContextText

    if (!lessonContextText || !lessonContextText.trim()) {
      return apiError(
        'VALIDATION_ERROR',
        'Lesson has no context text to extract exercises from',
        400,
      )
    }

    // Parse into exercises
    const segments = parseContextText(lessonContextText)
    const allExercises = segments.flatMap((seg) => seg.exercises)

    if (allExercises.length === 0) {
      return apiError('VALIDATION_ERROR', 'No exercises found in context text', 400)
    }

    // Delete existing context_extraction exercises for this lesson (idempotent)
    await payload.delete({
      collection: 'exercises',
      where: {
        lesson: { equals: lessonId },
        origin: { equals: 'context_extraction' },
      },
    })

    // Get current exercise count for ordering
    const currentExercises = await payload.find({
      collection: 'exercises',
      where: { lesson: { equals: lessonId } },
      limit: 0,
    })
    const startOrder = currentExercises.totalDocs

    // Create exercises with LaTeX blocks
    const createdIds: string[] = []
    const warnings: string[] = []

    for (let i = 0; i < allExercises.length; i++) {
      const exercise = allExercises[i]
      const blocks = [makeLatexBlock(exercise.latexContent)]

      // If exercise has a solution, add it as a second LaTeX block
      if (exercise.solution) {
        blocks.push(makeLatexBlock(exercise.solution))
      }

      try {
        const created = await payload.create({
          collection: 'exercises',
          data: {
            lesson: lessonId,
            title: exercise.title || `תרגיל ${exercise.number}`,
            content: { blocks },
            origin: 'context_extraction',
            order: startOrder + i,
          },
          draft: true,
        })
        createdIds.push(created.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        warnings.push(`Failed to create exercise ${exercise.number}: ${message}`)
      }
    }

    return apiSuccess({
      exerciseIds: createdIds,
      exerciseCount: createdIds.length,
      warnings: warnings.length > 0 ? warnings : undefined,
    })
  },
)
