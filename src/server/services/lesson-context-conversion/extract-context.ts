/**
 * Lesson Context Extraction Service
 *
 * Extracts context text from lesson content files (PDF/images) using AI prompts.
 * PDFs are segmented into page ranges and processed independently for reliability.
 * The extracted text is stored in the lesson's lessonContextText field.
 *
 * All Payload Local API calls use overrideAccess: false + user context for security.
 */
import { isVercelBlobUrl } from '@/infra/blob/vercel-blob-adapter'
import { getPdfConversionMaxSegmentPages } from '@/infra/config/system-params'
import { fetchBuffer } from '@/infra/utils/http'
import type { Lesson, Media, Prompt } from '@/payload-types'
import { getPdfBufferFromBlob, normalizeToAbsoluteUrl } from '@/server/services/pdf-fetcher'
import type { Payload, User } from 'payload'

import { extractPdfPages, segmentPdf } from './segment-pdf'
import { validateExtractedLatex } from './validate-latex'

export interface ExtractContextInput {
  lessonId: string
  promptId: string
  mediaId: string
  mode?: 'replace' | 'append'
}

export interface ExtractContextResult {
  success: boolean
  updatedContextText?: string
  extractedChunkLength?: number
  error?: string
  segmentsTotal?: number
  segmentsProcessed?: number
  segmentsFailed?: number
  warnings?: string[]
}

/**
 * Extract context text from a lesson content file and store in lessonContextText.
 *
 * For PDFs: splits into page-range segments, extracts each independently,
 * validates LaTeX output, and merges results. Partial success is preserved.
 *
 * For images: single extraction call (no segmentation needed).
 *
 * @param payload - Payload instance
 * @param user - Authenticated user for access control
 * @param input - Extraction parameters
 * @returns Result with updated context text or error message
 */
export async function extractLessonContext(
  payload: Payload,
  user: User,
  input: ExtractContextInput,
): Promise<ExtractContextResult> {
  const { lessonId, promptId, mediaId, mode = 'replace' } = input

  try {
    // ========== Step 1: Fetch lesson and validate tenant ==========
    const lesson = await payload.findByID({
      collection: 'lessons',
      id: lessonId,
      depth: 1,
      user,
      overrideAccess: false,
    })

    if (!lesson) {
      return { success: false, error: 'Lesson not found' }
    }

    const lessonTyped = lesson as unknown as Lesson
    const lessonTenant =
      typeof lessonTyped.tenant === 'object' ? lessonTyped.tenant?.id : lessonTyped.tenant

    if (!lessonTenant) {
      return { success: false, error: 'Lesson has no tenant' }
    }

    // ========== Step 2: Validate mediaId is in lesson's contentFiles ==========
    const contentFiles = lessonTyped.contentFiles || []
    const contentFileIds = contentFiles.map((cf) =>
      typeof cf === 'string' ? cf : (cf as unknown as { id: string }).id,
    )

    if (!contentFileIds.includes(mediaId)) {
      return { success: false, error: 'Media file is not attached to this lesson' }
    }

    // ========== Step 3: Fetch prompt and validate ==========
    const prompt = await payload.findByID({
      collection: 'prompts',
      id: promptId,
      depth: 0,
      user,
      overrideAccess: false,
    })

    if (!prompt) {
      return { success: false, error: 'Prompt not found' }
    }

    const promptTyped = prompt as unknown as Prompt

    if (promptTyped.usage !== 'context_extractor') {
      return { success: false, error: 'Prompt is not a context_extractor' }
    }

    if (promptTyped.status !== 'published') {
      return { success: false, error: 'Prompt is not published' }
    }

    const promptTenant =
      typeof promptTyped.tenant === 'object' ? promptTyped.tenant?.id : promptTyped.tenant

    if (promptTenant !== lessonTenant) {
      return { success: false, error: 'Prompt tenant does not match lesson tenant' }
    }

    if (!promptTyped.template) {
      return { success: false, error: 'Prompt template is empty' }
    }

    // ========== Step 4: Fetch media file ==========
    const media = await payload.findByID({
      collection: 'media',
      id: mediaId,
      depth: 0,
      user,
      overrideAccess: false,
    })

    if (!media) {
      return { success: false, error: 'Media file not found' }
    }

    const mediaTyped = media as unknown as Media

    if (!mediaTyped.url) {
      return { success: false, error: 'Media file has no URL' }
    }

    // Determine if PDF or image and fetch buffer
    const isPdf = mediaTyped.mimeType === 'application/pdf'
    let fileBuffer: Buffer

    if (isPdf) {
      fileBuffer = await getPdfBufferFromBlob(mediaId, payload)
    } else {
      let fetchUrl = mediaTyped.url

      if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
        fetchUrl = await normalizeToAbsoluteUrl(fetchUrl)
      }

      if (isVercelBlobUrl(fetchUrl)) {
        const { getPdfBufferFromUrl } = await import('@/infra/blob/vercel-blob-adapter')
        fileBuffer = await getPdfBufferFromUrl(fetchUrl)
      } else {
        fileBuffer = await fetchBuffer(fetchUrl, 30000)
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return { success: false, error: 'Failed to download media file' }
    }

    // ========== Step 5: Build base prompt with lesson metadata ==========
    const lessonTitle = lessonTyped.title || 'Untitled Lesson'
    const lessonDescription = lessonTyped.description || ''
    const metadataText = `Lesson: ${lessonTitle}\nDescription: ${lessonDescription}`
    const basePrompt = `${promptTyped.template}\n\n${metadataText}`

    // ========== Step 6: Initialize LLM adapter ==========
    const { createGenkitUnifiedAdapter } =
      await import('@/infra/llm/genkit/adapters/unified-adapter')
    const adapter = await createGenkitUnifiedAdapter(payload)

    const { getModelRegistryEntry, getProviderModelName } = await import('@/infra/llm/models')
    const { LLMProviderType } = await import('@/infra/llm/providers/types')
    const modelEntry = getModelRegistryEntry('PDF_TO_EXERCISE')
    const modelConfig = {
      name: getProviderModelName(LLMProviderType.GEMINI, 'PDF_TO_EXERCISE'),
      ...modelEntry,
    }

    // ========== Step 7: Extract — segmented for PDFs, single call for images ==========
    let extractedText: string
    let segmentsTotal = 1
    let segmentsProcessed = 0
    let segmentsFailed = 0
    const warnings: string[] = []

    if (isPdf) {
      // Segmented PDF extraction
      const maxPages = await getPdfConversionMaxSegmentPages(lessonTenant)
      const segments = await segmentPdf(fileBuffer, maxPages)
      segmentsTotal = segments.length

      const segmentResults: string[] = []

      for (const segment of segments) {
        const segmentPrompt = `${basePrompt}\n\nExtract ALL mathematical content, exercises, and explanations from pages ${segment.pageStart}-${segment.pageEnd} as LaTeX. Maintain the exact order and structure from the source.`

        let segmentText: string | null = null

        // Try extraction with one retry on failure
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const subPdfBuffer = await extractPdfPages(
              fileBuffer,
              segment.pageStart,
              segment.pageEnd,
            )
            const base64Data = subPdfBuffer.toString('base64')

            const response = await adapter.generateMultimodalCompletion(
              {
                prompt: segmentPrompt,
                model: modelConfig,
                attachments: [{ data: base64Data, mimeType: 'application/pdf' }],
              },
              payload,
            )

            const responseText = response.text?.trim()
            if (!responseText) {
              if (attempt === 0) continue
              break
            }

            // Validate the extracted LaTeX
            const validation = validateExtractedLatex(responseText)

            if (!validation.valid) {
              if (attempt === 0) continue
              // On second attempt, still use the text but log warnings
              warnings.push(
                `Pages ${segment.pageStart}-${segment.pageEnd}: validation errors: ${validation.errors.join('; ')}`,
              )
            }

            if (validation.isTruncated) {
              warnings.push(
                `Pages ${segment.pageStart}-${segment.pageEnd}: output appears truncated`,
              )
            }

            if (validation.warnings.length > 0) {
              for (const w of validation.warnings) {
                warnings.push(`Pages ${segment.pageStart}-${segment.pageEnd}: ${w}`)
              }
            }

            segmentText = validation.sanitizedText
            break
          } catch (error) {
            if (attempt === 1) {
              const msg = error instanceof Error ? error.message : 'Unknown error'
              warnings.push(
                `Pages ${segment.pageStart}-${segment.pageEnd}: extraction failed: ${msg}`,
              )
            }
          }
        }

        if (segmentText) {
          segmentResults.push(
            `% --- Pages ${segment.pageStart}-${segment.pageEnd} ---\n${segmentText}`,
          )
          segmentsProcessed++
        } else {
          segmentsFailed++
        }
      }

      if (segmentResults.length === 0) {
        return {
          success: false,
          error: 'All segments failed to extract',
          segmentsTotal,
          segmentsProcessed,
          segmentsFailed,
          warnings,
        }
      }

      extractedText = segmentResults.join('\n\n')
    } else {
      // Single call for images (no segmentation)
      const mimeType = mediaTyped.mimeType || 'image/png'
      const base64Data = fileBuffer.toString('base64')

      const response = await adapter.generateMultimodalCompletion(
        {
          prompt: basePrompt,
          model: modelConfig,
          attachments: [{ data: base64Data, mimeType }],
        },
        payload,
      )

      const responseText = response.text?.trim()
      if (!responseText) {
        return { success: false, error: 'AI returned empty response' }
      }

      const validation = validateExtractedLatex(responseText)
      if (validation.warnings.length > 0) {
        warnings.push(...validation.warnings)
      }

      extractedText = validation.sanitizedText
      segmentsProcessed = 1
    }

    // ========== Step 8: Store result based on mode ==========
    let updatedContextText: string

    if (mode === 'append') {
      const existingContext = lessonTyped.lessonContextText || ''
      const delimiter = '\n\n---\n\n'
      updatedContextText = existingContext
        ? `${existingContext}${delimiter}${extractedText}`
        : extractedText
    } else {
      updatedContextText = extractedText
    }

    // ========== Step 9: Update lesson ==========
    await payload.update({
      collection: 'lessons',
      id: lessonId,
      data: {
        lessonContextText: updatedContextText,
      },
      user,
      overrideAccess: false,
    })

    return {
      success: true,
      updatedContextText,
      extractedChunkLength: extractedText.length,
      segmentsTotal,
      segmentsProcessed,
      segmentsFailed,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  } catch (error) {
    console.error('[extractLessonContext] Error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
}
