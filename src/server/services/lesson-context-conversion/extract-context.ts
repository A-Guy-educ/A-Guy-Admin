/**
 * Lesson Context Extraction Service
 *
 * Extracts context text from lesson content files (PDF/images) using AI prompts.
 * The extracted text is appended to the lesson's lessonContextText field.
 *
 * PDFs are processed page-by-page with controlled concurrency (3 pages at a time)
 * for better extraction quality and to avoid truncation on longer documents.
 *
 * All Payload Local API calls use overrideAccess: false + user context for security.
 */
import { isVercelBlobUrl } from '@/infra/blob/vercel-blob-adapter'
import { fetchBuffer } from '@/infra/utils/http'
import type { Lesson, Media, Prompt } from '@/payload-types'
import type { UnifiedLLMProvider } from '@/infra/llm/providers/factory'
import type { AIModel } from '@/infra/llm/models'
import { getPdfBufferFromBlob, normalizeToAbsoluteUrl } from '@/server/services/pdf-fetcher'
import { splitPdfIntoPages } from '@/server/utils/pdf-page-splitter'
import type { Payload, User } from 'payload'

// Controlled concurrency for page-by-page PDF processing
const PAGE_CONCURRENCY = 3

// Warning threshold for combined LaTeX size
const LATEX_SIZE_WARNING_THRESHOLD = 80000

export interface ExtractContextInput {
  lessonId: string
  promptId: string
  mediaId: string
}

export interface ExtractContextResult {
  success: boolean
  updatedContextText?: string
  extractedChunkLength?: number
  error?: string
  warnings?: string[]
}

/**
 * Extract context text from a lesson content file and append to lessonContextText
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
  const { lessonId, promptId, mediaId } = input
  const warnings: string[] = []

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

    // Validate prompt usage
    if (promptTyped.usage !== 'context_extractor') {
      return { success: false, error: 'Prompt is not a context_extractor' }
    }

    // Validate prompt status
    if (promptTyped.status !== 'published') {
      return { success: false, error: 'Prompt is not published' }
    }

    // Validate tenant match
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
      // For images, fetch using the URL
      let fetchUrl = mediaTyped.url

      // Normalize relative URLs to absolute
      if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
        fetchUrl = await normalizeToAbsoluteUrl(fetchUrl)
      }

      // Handle Vercel Blob URLs
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

    // ========== Step 5: Build prompt with lesson metadata ==========
    const lessonTitle = lessonTyped.title || 'Untitled Lesson'
    const lessonDescription = lessonTyped.description || ''

    // Simple text description for context
    const metadataText = `Lesson: ${lessonTitle}\nDescription: ${lessonDescription}`

    // Build the full prompt
    const fullPrompt = `${promptTyped.template}\n\n${metadataText}`

    // ========== Step 6: Call LLM via adapter ==========
    const { createGenkitUnifiedAdapter } =
      await import('@/infra/llm/genkit/adapters/unified-adapter')
    const adapter = await createGenkitUnifiedAdapter(payload)

    // Use PDF_TO_EXERCISE model (established pattern for document processing)
    const { getModelRegistryEntry, getProviderModelName } = await import('@/infra/llm/models')
    const { LLMProviderType } = await import('@/infra/llm/providers/types')
    const modelEntry = getModelRegistryEntry('PDF_TO_EXERCISE')
    const modelConfig = {
      name: getProviderModelName(LLMProviderType.GEMINI, 'PDF_TO_EXERCISE'),
      ...modelEntry,
    }

    // ========== Process based on media type ==========
    let extractedText: string

    if (isPdf) {
      // ========== PDF: Process page-by-page with controlled concurrency ==========
      const pages = await splitPdfIntoPages(fileBuffer)
      const totalPages = pages.length

      warnings.push(`Processing ${totalPages} pages with concurrency ${PAGE_CONCURRENCY}`)

      // Process pages in batches
      const results: Array<{ pageIndex: number; latex: string | null; warning?: string }> = []

      for (let i = 0; i < pages.length; i += PAGE_CONCURRENCY) {
        const batch = pages.slice(i, i + PAGE_CONCURRENCY)
        const batchResults = await Promise.allSettled(
          batch.map((pageBuffer, _batchIdx) =>
            extractSinglePage(
              adapter,
              modelConfig,
              fullPrompt,
              pageBuffer,
            ),
          ),
        )

        // Collect results
        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j]
          const pageIndex = i + j

          if (result.status === 'fulfilled') {
            results.push({ pageIndex, latex: result.value.latex, warning: result.value.warning })
          } else {
            const errorMsg = result.reason instanceof Error ? result.reason.message : 'Unknown error'
            warnings.push(
              `Page ${pageIndex + 1}/${totalPages}: extraction failed — ${errorMsg}. Skipped.`,
            )
            results.push({ pageIndex, latex: null })
          }
        }
      }

      // Sort by page index to ensure correct order
      results.sort((a, b) => a.pageIndex - b.pageIndex)

      // Check if all pages failed
      const successfulResults = results.filter((r) => r.latex !== null)
      if (successfulResults.length === 0) {
        return {
          success: false,
          error: 'All pages failed extraction',
          warnings,
        }
      }

      // Report skipped pages
      const skippedCount = results.filter((r) => r.latex === null).length
      if (skippedCount > 0) {
        warnings.push(
          `Successfully extracted ${successfulResults.length}/${totalPages} pages. ${skippedCount} pages skipped.`,
        )
      } else {
        warnings.push(`Successfully extracted all ${totalPages} pages.`)
      }

      // Stitch results together
      extractedText = stitchLatexPages(successfulResults.map((r) => r.latex!))

      // Add size warning if needed
      if (extractedText.length > LATEX_SIZE_WARNING_THRESHOLD) {
        warnings.push(
          `Warning: Extracted LaTeX (${extractedText.length} chars) exceeds ${LATEX_SIZE_WARNING_THRESHOLD} char threshold. Consider splitting into multiple lessons.`,
        )
      }

      // Add per-page success messages
      for (const r of results) {
        if (r.latex !== null) {
          warnings.push(`Page ${r.pageIndex + 1}/${totalPages}: extracted successfully (${r.latex.length} chars)`)
        }
        if (r.warning) {
          warnings.push(`Page ${r.pageIndex + 1}/${totalPages}: ${r.warning}`)
        }
      }
    } else {
      // ========== Non-PDF (image): Single call, existing behavior ==========
      const mimeType = mediaTyped.mimeType || 'image/png'
      const base64Data = fileBuffer.toString('base64')

      const response = await adapter.generateMultimodalCompletion(
        {
          prompt: fullPrompt,
          model: modelConfig,
          attachments: [
            {
              data: base64Data,
              mimeType,
            },
          ],
        },
        payload,
      )

      // Validate non-empty response
      extractedText = response.text?.trim()

      if (!extractedText) {
        return { success: false, error: 'AI returned empty response', warnings }
      }
    }

    // ========== Step 7: Append to existing lessonContextText ==========
    const existingContext = lessonTyped.lessonContextText || ''
    const delimiter = '\n\n---\n\n'
    const updatedContextText = existingContext
      ? `${existingContext}${delimiter}${extractedText}`
      : extractedText

    // ========== Step 8: Update lesson ==========
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
      warnings,
    }
  } catch (error) {
    console.error('[extractLessonContext] Error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage, warnings }
  }
}

/**
 * Extract LaTeX content from a single PDF page.
 */
async function extractSinglePage(
  adapter: UnifiedLLMProvider,
  modelConfig: AIModel,
  prompt: string,
  pageBuffer: Buffer,
): Promise<{ latex: string; warning?: string }> {
  const base64Data = pageBuffer.toString('base64')

  const response = await adapter.generateMultimodalCompletion(
    {
      prompt,
      model: modelConfig,
      attachments: [
        {
          data: base64Data,
          mimeType: 'application/pdf',
        },
      ],
    },
    // Pass a minimal payload instance - the adapter uses it for config resolution
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
  )

  const extractedText = response.text?.trim()

  if (!extractedText) {
    throw new Error('AI returned empty response')
  }

  // Basic LaTeX validation - check for balanced braces
  const openBraces = (extractedText.match(/\\{/g) || []).length
  const closeBraces = (extractedText.match(/\\}/g) || []).length
  if (openBraces !== closeBraces) {
    const warning = 'LaTeX validation warning — unbalanced braces'
    // Still return the text, but include a warning
    return { latex: extractedText, warning }
  }

  return { latex: extractedText }
}

/**
 * Stitch multiple LaTeX page results into a single valid LaTeX document.
 *
 * - Keeps the preamble (\documentclass through \begin{document}) from the first page only
 * - Strips preamble from subsequent pages
 * - Joins content in page order
 * - Ensures one \end{document} at the end
 */
function stitchLatexPages(pages: string[]): string {
  if (pages.length === 0) return ''
  if (pages.length === 1) return pages[0]

  // Extract parts from first page
  const firstPage = pages[0]
  const preambleEnd = firstPage.indexOf('\\begin{document}')
  const firstDocumentEnd = firstPage.indexOf('\\end{document}')

  let preamble: string
  let firstContent: string

  if (preambleEnd !== -1 && firstDocumentEnd !== -1 && preambleEnd < firstDocumentEnd) {
    // Extract complete preamble including \begin{document}
    preamble = firstPage.slice(0, firstDocumentEnd + '\\end{document}'.length)
    firstContent = firstPage.slice(firstDocumentEnd + '\\end{document}'.length)
  } else {
    // Fallback: treat entire first page as content (no standard preamble found)
    preamble = ''
    firstContent = firstPage
  }

  // Strip preamble and \end{document} from subsequent pages
  const subsequentContent = pages.slice(1).map((page) => {
    // Find and strip everything before and including \begin{document}
    const docStart = page.indexOf('\\begin{document}')
    // Find and strip \end{document}
    const docEnd = page.indexOf('\\end{document}')

    if (docStart !== -1 && docEnd !== -1 && docStart < docEnd) {
      // Extract content between \begin{document} and \end{document}
      return page.slice(docEnd + '\\end{document}'.length).trim()
    }

    // If no standard structure found, look for outline comments to strip
    let content = page
    // Strip lines starting with % outline markers at the beginning
    content = content.replace(/^%.*\n/gm, '')
    return content.trim()
  })

  // Combine: preamble (if any), first page content, subsequent pages content
  const allContent = [firstContent.trim(), ...subsequentContent]
    .filter((c) => c.length > 0)
    .join('\n\n')

  if (preamble) {
    // Insert content before \end{document}
    const lastBrace = preamble.lastIndexOf('}')
    if (lastBrace !== -1) {
      return preamble.slice(0, lastBrace) + '\n\n' + allContent + '\n' + '\\end{document}'
    }
    // Fallback: append content before \end{document}
    return preamble.replace('\\end{document}', '\n\n' + allContent + '\n\\end{document}')
  }

  // No preamble found - just join content
  return allContent
}
