/**
 * Plain-text lesson import API
 *
 * POST /api/lessons/import-from-text
 * Body: { chapterId, filename, text }
 *
 * Creates one draft practice Lesson per file plus one Exercise per תרגיל,
 * mirroring the JSON importer's contract (same response envelope, same
 * rollback-on-any-failure semantics).
 */
import type { PayloadRequest } from 'payload'

import { ApiErrors, apiError, apiSuccess } from '@/server/api/responses'
import { withApiHandler } from '@/server/api/with-api-handler'
import { importTextLessonFromFile } from '@/server/services/text-lesson-import/import-text-lesson'
import { z } from 'zod'

const importBodySchema = z.object({
  chapterId: z.string().min(1, 'chapterId is required'),
  filename: z.string().min(1, 'filename is required'),
  text: z.string().min(1, 'text is required'),
})

type ImportBody = z.infer<typeof importBodySchema>

export const POST = withApiHandler<ImportBody, unknown>(
  {
    auth: 'admin',
    bodySchema: importBodySchema,
  },
  async ({ payload, user, body, request }) => {
    const payloadReq = {
      payload,
      user: user!,
      url: request.url,
      headers: request.headers,
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    const result = await importTextLessonFromFile(payloadReq, body)

    if ('kind' in result) {
      if (result.kind === 'not_found') return ApiErrors.notFound('Chapter')
      return apiError('VALIDATION_ERROR', 'Text lesson could not be parsed', 422, {
        issues: result.issues.map((i) => `[${i.path}] ${i.message}`),
      })
    }
    return apiSuccess(result)
  },
)
