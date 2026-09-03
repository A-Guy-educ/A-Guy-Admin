/**
 * Raw-LaTeX lesson import API
 *
 * POST /api/lessons/import-from-latex
 * Body: { chapterId, filename, content }
 *
 * Creates a Media (.tex) + draft practice Lesson pair, attaches the file
 * to lesson.contentFiles, then runs the same "Full Convert (LaTeX)"
 * pipeline that powers the button on the lesson edit view. On pipeline
 * failure the lesson + media are LEFT IN PLACE and the response returns
 * `success: false` with the lessonId — so the admin can open the lesson
 * and retry via that button. See the service for rationale.
 */
import type { PayloadRequest } from 'payload'

import { apiError, apiSuccess } from '@/server/api/responses'
import { withApiHandler } from '@/server/api/with-api-handler'
import { importLatexLessonFromFile } from '@/server/services/latex-lesson-import/import-latex-lesson'
import { z } from 'zod'

const importBodySchema = z.object({
  chapterId: z.string().min(1),
  filename: z.string().min(1, 'filename is required'),
  content: z.string().min(1, 'content is required'),
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

    const result = await importLatexLessonFromFile(payloadReq, user!, body)

    if ('kind' in result) {
      if (result.kind === 'not_found') {
        return apiError('NOT_FOUND', result.message, 404)
      }
      return apiError('VALIDATION_ERROR', 'LaTeX file could not be imported', 422, {
        issues: result.issues.map((i) => `[${i.path}] ${i.message}`),
      })
    }

    return apiSuccess(result)
  },
)
