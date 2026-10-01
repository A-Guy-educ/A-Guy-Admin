/**
 * Lesson Blocks Transfer API
 *
 * POST /api/lessons/transfer-blocks
 * Moves selected exercise/content-page refs from one lesson to another by
 * updating each ref doc's `lesson` field. The `afterChange` hooks on
 * Exercises and ContentPages take care of removing the block from the source
 * lesson's `blocks` playlist and appending it to the target's.
 */
import type { PayloadRequest } from 'payload'

import { apiError, apiSuccess } from '@/server/api/responses'
import { withApiHandler } from '@/server/api/with-api-handler'
import { z } from 'zod'

const refSchema = z.object({
  refId: z.string().min(1),
  blockType: z.enum(['exerciseRef', 'contentPageRef']),
})

const transferBodySchema = z
  .object({
    sourceLessonId: z.string().min(1),
    targetLessonId: z.string().min(1),
    refs: z.array(refSchema).min(1).max(200),
  })
  .refine((data) => data.sourceLessonId !== data.targetLessonId, {
    message: 'sourceLessonId and targetLessonId must differ',
    path: ['targetLessonId'],
  })

type TransferBody = z.infer<typeof transferBodySchema>

interface TransferResult {
  transferred: number
  failed: number
  failures: Array<{ refId: string; blockType: string; error: string }>
}

export const POST = withApiHandler<TransferBody, unknown>(
  {
    auth: 'admin',
    bodySchema: transferBodySchema,
  },
  async ({ payload, user, body, request }) => {
    const { sourceLessonId, targetLessonId, refs } = body

    // Thread request context into Payload Local API calls so the sync hooks
    // on Exercises/ContentPages (afterChange → remove/addBlockFromLesson)
    // run with the acting user and can propagate transactionID — mirrors the
    // import-from-json route convention.
    const payloadReq = {
      payload,
      user: user!,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const [source, target] = await Promise.all([
      payload
        .findByID({ collection: 'lessons', id: sourceLessonId, depth: 0, req: payloadReq })
        .catch(() => null),
      payload
        .findByID({ collection: 'lessons', id: targetLessonId, depth: 0, req: payloadReq })
        .catch(() => null),
    ])

    if (!source)
      return apiError('LESSON_NOT_FOUND', `Source lesson ${sourceLessonId} not found`, 404)
    if (!target)
      return apiError('LESSON_NOT_FOUND', `Target lesson ${targetLessonId} not found`, 404)

    const result: TransferResult = { transferred: 0, failed: 0, failures: [] }

    for (const ref of refs) {
      const collection = ref.blockType === 'exerciseRef' ? 'exercises' : 'content-pages'
      try {
        await payload.update({
          collection,
          id: ref.refId,
          data: { lesson: targetLessonId },
          req: payloadReq,
        })
        result.transferred += 1
      } catch (err) {
        result.failed += 1
        result.failures.push({
          refId: ref.refId,
          blockType: ref.blockType,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return apiSuccess(result)
  },
)
