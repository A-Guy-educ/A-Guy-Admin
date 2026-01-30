<<<<<<< Updated upstream
import { validatePromptForUsageAndTenant } from '@/lib/exercise-conversion/helpers'
import { ENV, MAX_PROMPT_SIZE_BYTES } from '@/server/config/constants'
=======
import { apiError, apiSuccess } from '@/server/api/responses'
import { queueConversionSchema } from '@/server/api/schemas/job-schemas'
import { withApiHandler } from '@/server/api/with-api-handler'
import { MAX_PROMPT_SIZE_BYTES } from '@/server/config/constants'
import { validatePromptForUsageAndTenant } from '@/server/services/exercise-conversion/helpers'
>>>>>>> Stashed changes
import { hashTextSha256 } from '@/server/utils/hash'

export const POST = withApiHandler(
  { auth: 'adminOrTest', bodySchema: queueConversionSchema },
  async ({ payload, body, logger }) => {
    try {
      const { lessonId, mediaId, extractorPromptId, verifierPromptId } = body

      // Server-side Tenant Resolution
      const lesson = await payload.findByID({ collection: 'lessons', id: lessonId, depth: 0 })

      if (!lesson) {
        return apiError('LESSON_NOT_FOUND', 'Lesson not found', 404)
      }

      const tenant = (lesson as any).tenant
      const lessonTenantId = tenant?.id || tenant
      if (!lessonTenantId) {
        return apiError('VALIDATION_ERROR', 'Lesson has no tenant', 400)
      }

      // Validate media belongs to lesson
      const mediaIds = ((lesson as any).contentFiles || []).map((m: any) =>
        typeof m === 'string' ? m : m.id,
      )
      if (!mediaIds.includes(mediaId)) {
        return apiError('MEDIA_NOT_ATTACHED', 'Media is not attached to this lesson', 400)
      }

      // Fetch and validate extractor prompt
      const extractorPrompt = await payload.findByID({
        collection: 'prompts',
        id: extractorPromptId,
        depth: 0,
        overrideAccess: true,
      })

      if (!extractorPrompt) {
        return apiError('PROMPT_NOT_FOUND', `Extractor prompt not found: ${extractorPromptId}`, 400)
      }

      validatePromptForUsageAndTenant(
        extractorPrompt as unknown as { status: string; usage: string; tenant: any },
        'extractor',
        lessonTenantId,
      )

      // Fetch and validate verifier prompt
      const verifierPrompt = await payload.findByID({
        collection: 'prompts',
        id: verifierPromptId,
        depth: 0,
        overrideAccess: true,
      })

      if (!verifierPrompt) {
        return apiError('PROMPT_NOT_FOUND', `Verifier prompt not found: ${verifierPromptId}`, 400)
      }

      validatePromptForUsageAndTenant(
        verifierPrompt as unknown as { status: string; usage: string; tenant: any },
        'verifier',
        lessonTenantId,
      )

      // Prompt size validation
      const extractorSize = Buffer.byteLength(extractorPrompt.template, 'utf8')
      if (extractorSize > MAX_PROMPT_SIZE_BYTES) {
        return apiError('VALIDATION_ERROR', 'Extractor prompt template exceeds maximum size', 400)
      }
      const verifierSize = Buffer.byteLength(verifierPrompt.template, 'utf8')
      if (verifierSize > MAX_PROMPT_SIZE_BYTES) {
        return apiError('VALIDATION_ERROR', 'Verifier prompt template exceeds maximum size', 400)
      }

      // Store prompt snapshots
      const extractorHash = hashTextSha256(extractorPrompt.template)
      const verifierHash = hashTextSha256(verifierPrompt.template)

      // Queue the job
      const job = await payload.jobs.queue({
        task: 'pdf_to_exercises',
        input: {
          ctx: { lessonId, sourceDocId: mediaId, tenantId: lessonTenantId },
          maxSegmentPages: 2,
          promptRefs: { extractorPromptId, verifierPromptId },
          promptSnapshot: {
            extractor: extractorPrompt.template,
            verifier: verifierPrompt.template,
          },
          promptSnapshotHash: { extractor: extractorHash, verifier: verifierHash },
        },
      })

      logger.info({ jobId: job.id, lessonId, mediaId }, 'Conversion job queued')
      return apiSuccess({ jobId: job.id }, 'Conversion job queued', 201)
    } catch (err) {
      const error = err as Error & { code?: string }
      console.error('[Queue] Error:', error)
      if (error.code) {
        return apiError(error.code as any, error.message, 400)
      }
      return apiError('INTERNAL_ERROR', 'Internal server error', 500)
    }
  },
)
