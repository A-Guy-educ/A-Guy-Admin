/**
 * POST /api/exercises/import?lessonId=<id>
 * Convert lesson contentFile to exercise using AI
 *
 * Access: Authenticated users only
 */
import { PayloadRequest } from 'payload'
import { extractFromImage } from '@/lib/ai/services/data-extractor-service'
import type { Media } from '@/payload-types'
import { randomUUID } from 'crypto'
import type {
  QuestionMcqBlock,
  QuestionFreeResponseBlock,
  InlineRichText,
  McqOption,
} from '@/collections/Exercises'

export async function importExerciseFromLesson(req: PayloadRequest) {
  // 1) Auth - endpoints not authenticated by default
  if (!req.user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  // 2) Get lessonId from query params
  const url = new URL(req.url || 'http://localhost')
  const lessonId = url.searchParams.get('lessonId')

  if (!lessonId) {
    return Response.json({ error: 'lessonId query parameter is required' }, { status: 400 })
  }

  // 3) Fetch lesson with contentFile
  const lesson = await req.payload.findByID({
    collection: 'lessons',
    id: lessonId,
    depth: 1,
  })

  if (!lesson) {
    return Response.json({ error: 'Lesson not found' }, { status: 404 })
  }

  // 4) Check if contentFile exists
  const contentFile = lesson.contentFile as Media | null | undefined
  if (!contentFile || !contentFile.url) {
    return Response.json({ error: 'Lesson has no content file to convert' }, { status: 400 })
  }

  // 5) Fetch image from storage URL as buffer
  let imageBuffer: Buffer
  let mimeType: string

  try {
    // Fetch from the URL (works with Vercel Blob, S3, filesystem, etc.)
    const imageResponse = await fetch(contentFile.url)

    if (!imageResponse.ok) {
      return Response.json(
        { error: 'Failed to fetch lesson content file from storage' },
        { status: 500 },
      )
    }

    const arrayBuffer = await imageResponse.arrayBuffer()
    imageBuffer = Buffer.from(arrayBuffer)
    mimeType = contentFile.mimeType || 'image/jpeg'
  } catch (fetchError) {
    return Response.json(
      { error: 'Failed to fetch lesson content file from storage' },
      { status: 500 },
    )
  }

  // 6) Extract data from image
  const result = await extractFromImage({
    imageBuffer,
    mimeType,
  })

  if (!result.success) {
    return Response.json({ error: result.error || 'Failed to process image' }, { status: 500 })
  }

  // 7) Create exercise from extracted data using Zod types
  if (result.data) {
    try {
      const hasOptions = result.data.options && result.data.options.length > 0

      // Build question block using Zod-validated types
      let questionBlock: QuestionMcqBlock | QuestionFreeResponseBlock

      if (hasOptions) {
        // Build MCQ options using McqOption type
        const options: McqOption[] = result.data.options.map((opt: string, i: number) => ({
          id: `opt-${i + 1}`,
          content: {
            type: 'rich_text' as const,
            format: 'md-math-v1' as const,
            value: opt,
            mediaIds: [],
          },
        }))

        const correctIds =
          result.data.correctAnswer !== null && result.data.correctAnswer !== undefined
            ? [`opt-${result.data.correctAnswer + 1}`]
            : ['opt-1']

        // Build MCQ block using QuestionMcqBlock type
        questionBlock = {
          id: randomUUID(),
          type: 'question_mcq' as const,
          prompt: {
            type: 'rich_text' as const,
            format: 'md-math-v1' as const,
            value: result.data.question,
            mediaIds: [],
          },
          answer: {
            multiSelect: false,
            options,
            correctOptionIds: correctIds,
          },
        }

        if (result.data.explanation) {
          const solution: InlineRichText = {
            type: 'rich_text' as const,
            format: 'md-math-v1' as const,
            value: result.data.explanation,
            mediaIds: [],
          }
          questionBlock.solution = solution
        }
      } else {
        // Build free response block using QuestionFreeResponseBlock type
        questionBlock = {
          id: randomUUID(),
          type: 'question_free_response' as const,
          prompt: {
            type: 'rich_text' as const,
            format: 'md-math-v1' as const,
            value: result.data.question,
            mediaIds: [],
          },
          answer: {
            responseKind: 'text' as const,
            acceptedAnswers: [result.data.explanation || 'See solution'],
            tolerance: 0,
          },
        }

        if (result.data.explanation) {
          const solution: InlineRichText = {
            type: 'rich_text' as const,
            format: 'md-math-v1' as const,
            value: result.data.explanation,
            mediaIds: [],
          }
          questionBlock.solution = solution
        }
      }

      const exerciseDoc = await req.payload.create({
        collection: 'exercises',
        data: {
          title: 'AI Generated Exercise',
          order: 0,
          lesson: lessonId,
          content: {
            blocks: [questionBlock],
          },
        },
      })

      return Response.json({
        success: true,
        data: result.data,
        metadata: result.metadata,
        exerciseId: exerciseDoc.id,
      })
    } catch (createError) {
      // Exercise creation failed, but AI extraction succeeded
      return Response.json(
        {
          error: 'AI conversion succeeded but exercise creation failed',
          details: createError instanceof Error ? createError.message : 'Unknown error',
        },
        { status: 500 },
      )
    }
  }

  return Response.json({
    success: true,
    data: result.data,
    metadata: result.metadata,
  })
}
