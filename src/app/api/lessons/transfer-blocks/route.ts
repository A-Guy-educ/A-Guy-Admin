/**
 * Lesson Blocks Transfer API
 *
 * POST /api/lessons/transfer-blocks
 * Moves selected exercise/content-page refs from one lesson to another.
 *
 * Flow:
 *   1. Flip each ref doc's `lesson` field with `context: { _skipBlockSync: true }`
 *      so the per-doc afterChange sync hooks do NOT fan out into N read-modify-
 *      write cycles against the lesson docs.
 *   2. Rewrite the source and target lessons' `blocks` JSON exactly once each,
 *      removing the transferred refs from source and appending them to target.
 *
 * This keeps the request bounded to ~N exercise updates + 2 lesson updates
 * rather than N × 5 cascaded roundtrips.
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
    // Capped at 50 — each ref still costs one exercise/content-page update
    // with hooks (beforeChange re-derives chapter/course). Even with the
    // batched lesson writes, 200 serial exercise updates can brush Vercel's
    // function timeout on cold starts.
    refs: z.array(refSchema).min(1).max(50),
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

interface BlockEntry {
  id: string
  blockType: 'exerciseRef' | 'contentPageRef'
  exercise?: string
  contentPage?: string
}

function parseBlocks(raw: unknown): BlockEntry[] {
  if (Array.isArray(raw)) return raw as BlockEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockEntry[]
    } catch {
      // fall through
    }
  }
  return []
}

function generateBlockId(): string {
  return Math.random().toString(36).slice(2, 14)
}

function refKey(blockType: BlockEntry['blockType'], refId: string): string {
  return `${blockType}::${refId}`
}

export const POST = withApiHandler<TransferBody, unknown>(
  {
    auth: 'admin',
    bodySchema: transferBodySchema,
  },
  async ({ payload, user, body, request }) => {
    const { sourceLessonId, targetLessonId, refs } = body

    // Thread request context into Payload Local API calls so hooks see the
    // acting user. `_skipBlockSync: true` tells the Exercises/ContentPages
    // afterChange hooks to NOT touch lesson.blocks — we rewrite them in bulk
    // once per lesson after all ref updates finish.
    const payloadReq = {
      payload,
      user: user!,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: { _skipBlockSync: true },
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
    const successfulRefs: Array<{ refId: string; blockType: 'exerciseRef' | 'contentPageRef' }> = []

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
        successfulRefs.push(ref)
      } catch (err) {
        result.failed += 1
        result.failures.push({
          refId: ref.refId,
          blockType: ref.blockType,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    // If nothing moved, both lesson blocks arrays are already consistent with
    // reality (every ref doc still points at source). Skip the rewrites.
    if (successfulRefs.length > 0) {
      const successKeys = new Set(successfulRefs.map((r) => refKey(r.blockType, r.refId)))

      const sourceBlocks = parseBlocks((source as { blocks?: unknown }).blocks)
      const nextSourceBlocks = sourceBlocks.filter((b) => {
        const id = b.blockType === 'exerciseRef' ? b.exercise : b.contentPage
        return !id || !successKeys.has(refKey(b.blockType, id))
      })

      const targetBlocks = parseBlocks((target as { blocks?: unknown }).blocks)
      const alreadyInTarget = new Set(
        targetBlocks
          .map((b) => {
            const id = b.blockType === 'exerciseRef' ? b.exercise : b.contentPage
            return id ? refKey(b.blockType, id) : null
          })
          .filter((v): v is string => Boolean(v)),
      )
      const appended: BlockEntry[] = []
      for (const ref of successfulRefs) {
        if (alreadyInTarget.has(refKey(ref.blockType, ref.refId))) continue
        appended.push({
          id: generateBlockId(),
          blockType: ref.blockType,
          ...(ref.blockType === 'exerciseRef'
            ? { exercise: ref.refId }
            : { contentPage: ref.refId }),
        })
      }
      const nextTargetBlocks = [...targetBlocks, ...appended]

      await Promise.all([
        nextSourceBlocks.length === sourceBlocks.length
          ? Promise.resolve()
          : payload.update({
              collection: 'lessons',
              id: sourceLessonId,
              data: { blocks: JSON.stringify(nextSourceBlocks) },
              req: payloadReq,
              overrideAccess: true,
            }),
        appended.length === 0
          ? Promise.resolve()
          : payload.update({
              collection: 'lessons',
              id: targetLessonId,
              data: { blocks: JSON.stringify(nextTargetBlocks) },
              req: payloadReq,
              overrideAccess: true,
            }),
      ])
    }

    return apiSuccess(result)
  },
)
