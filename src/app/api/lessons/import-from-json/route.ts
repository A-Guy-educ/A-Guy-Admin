/**
 * Lesson JSON Import API
 *
 * POST /api/lessons/import-from-json
 * Creates a Lesson (draft, practice type, Hebrew) plus one Exercise per item in
 * the source JSON's `exercises[]`. Each section in an exercise becomes a
 * question_select MCQ block, with optional rich_text/svg context blocks.
 */
import { ApiErrors, apiError, apiSuccess } from '@/server/api/responses'
import { withApiHandler } from '@/server/api/with-api-handler'
import { importLessonFromJson } from '@/server/services/lesson-json-import/import-lesson'
import { z } from 'zod'

const importBodySchema = z.object({
  chapterId: z.string().min(1, 'chapterId is required'),
  filename: z.string().min(1, 'filename is required'),
  // json is unknown — the import service validates it against the strict schema
  json: z.unknown(),
})

type ImportBody = z.infer<typeof importBodySchema>

export const POST = withApiHandler<ImportBody, unknown>(
  {
    auth: 'admin',
    bodySchema: importBodySchema,
  },
  async ({ payload, user, body }) => {
    const result = await importLessonFromJson(payload, user!, body)

    if ('kind' in result) {
      if (result.kind === 'not_found') {
        return ApiErrors.notFound('Chapter')
      }
      return apiError('VALIDATION_ERROR', 'JSON does not match the expected lesson format', 422, {
        issues: result.issues.map((i) => `[${i.path}] ${i.message}`),
      })
    }

    return apiSuccess(result)
  },
)
