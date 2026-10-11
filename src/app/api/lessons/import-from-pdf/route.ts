/**
 * PDF lesson import API
 *
 * POST /api/lessons/import-from-pdf
 * Body: { chapterId, filename, pdfBase64, lessonType? }
 *
 * Creates a Media (PDF) + draft Lesson pair; the lesson's title is derived
 * from the filename and the PDF is attached as `contentFiles[0]`. No exercise
 * generation — this is the "upload a PDF, get a lesson stub" path for Boss.
 */
import type { PayloadRequest } from 'payload'

import { apiError, apiSuccess } from '@/server/api/responses'
import { withApiHandler } from '@/server/api/with-api-handler'
import { importPdfLessonFromFile } from '@/server/services/pdf-lesson-import/import-pdf-lesson'
import { z } from 'zod'

const importBodySchema = z.object({
  chapterId: z.string().min(1),
  filename: z.string().min(1, 'filename is required'),
  pdfBase64: z.string().min(1, 'pdfBase64 is required'),
  lessonType: z.enum(['learning', 'practice', 'exam']).optional(),
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

    const result = await importPdfLessonFromFile(payloadReq, user!, body)

    if ('kind' in result) {
      if (result.kind === 'not_found') {
        return apiError('NOT_FOUND', result.message, 404)
      }
      return apiError('VALIDATION_ERROR', 'PDF file could not be imported', 422, {
        issues: result.issues.map((i) => `[${i.path}] ${i.message}`),
      })
    }

    return apiSuccess(result)
  },
)
