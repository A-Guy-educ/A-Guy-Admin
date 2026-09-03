/**
 * Service for importing a raw .tex file as a brand-new lesson.
 *
 * Bridges the drag-and-drop admin/lesson-json-import page to the existing
 * "Full Convert (LaTeX)" pipeline that lives on the lesson edit view:
 *
 *   1. Create the Media doc with the .tex bytes.
 *   2. Create a draft practice Lesson under the chosen chapter, with the
 *      new media attached via `contentFiles`.
 *   3. Delegate to `runFullLatexPipeline` — same deterministic split +
 *      per-exercise LaTeX-block conversion (with AI fallback) the button
 *      already runs.
 *
 * On pipeline failure the lesson + media are LEFT IN PLACE. That's the
 * whole point of routing through the media/ContextExtraction pipeline —
 * admins can open the created lesson and click "Full Convert (LaTeX)"
 * again to retry (the AI fallback is stochastic). This diverges from the
 * .json/.txt importers, which roll back on any error.
 */
import type { PayloadRequest, User } from 'payload'

import { runFullLatexPipeline } from '@/server/services/lesson-context-conversion/full-pipeline'

import { deriveLessonTitle } from '../text-lesson-import/convert-text-exercise'

export interface ImportLatexLessonInput {
  chapterId: string
  filename: string
  content: string
}

/**
 * Success + pipeline-failure share this shape so the API route can return
 * both via `apiSuccess`. `success: false` with a `lessonId` means the
 * lesson + media were created but the deterministic split/AI conversion
 * failed — the admin can open the lesson and retry via the existing
 * "Full Convert (LaTeX)" button.
 */
export interface ImportLatexLessonResult {
  success: boolean
  lessonId: string
  lessonTitle: string
  mediaId: string
  exercisesCreated: number
  /** Blocks the deterministic parser + AI fallback couldn't convert. Soft-failure — the exercise still exists with its raw LaTeX block. */
  latexBlocksFailed: number
  warnings: string[]
  /** Human-readable status. Present on partial-success and pipeline-failure. */
  message?: string
}

export interface ImportLatexLessonNotFoundError {
  kind: 'not_found'
  message: string
}

export interface ImportLatexLessonValidationError {
  kind: 'validation'
  issues: Array<{ path: string; message: string }>
}

export type ImportLatexLessonError =
  | ImportLatexLessonNotFoundError
  | ImportLatexLessonValidationError

async function resolveLessonOrder(req: PayloadRequest, chapterId: string): Promise<number> {
  const existing = await req.payload.find({
    collection: 'lessons',
    where: { chapter: { equals: chapterId } },
    sort: '-order',
    limit: 1,
    depth: 0,
    req,
    overrideAccess: true,
  })
  const top = existing.docs[0] as { order?: number } | undefined
  return (top?.order ?? -1) + 1
}

export async function importLatexLessonFromFile(
  req: PayloadRequest,
  user: User,
  input: ImportLatexLessonInput,
): Promise<ImportLatexLessonResult | ImportLatexLessonError> {
  if (!input.content.trim()) {
    return {
      kind: 'validation',
      issues: [{ path: 'content', message: 'The .tex file is empty' }],
    }
  }

  const chapter = await req.payload.findByID({
    collection: 'chapters',
    id: input.chapterId,
    depth: 0,
    req,
    overrideAccess: false,
    user,
  })
  if (!chapter) return { kind: 'not_found', message: 'Chapter not found' }

  const buffer = Buffer.from(input.content, 'utf-8')
  const lessonTitle = deriveLessonTitle({ filename: input.filename })

  // Media first so the lesson can reference it in contentFiles without a
  // second update round-trip. If the media create fails the whole import
  // errors out before we've touched the lessons collection.
  const media = await req.payload.create({
    collection: 'media',
    data: {
      filename: input.filename,
      mimeType: 'application/x-tex',
      filesize: buffer.length,
      alt: lessonTitle,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    file: {
      data: buffer,
      mimetype: 'application/x-tex',
      name: input.filename,
      size: buffer.length,
    },
    req,
    overrideAccess: true,
    user,
  })

  const order = await resolveLessonOrder(req, input.chapterId)
  const lesson = await req.payload.create({
    collection: 'lessons',
    data: {
      locale: 'he',
      chapter: input.chapterId,
      type: 'practice',
      title: lessonTitle,
      order,
      status: 'draft',
      isActive: true,
      contentFiles: [media.id],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    req,
    overrideAccess: false,
    user,
  })

  const pipeline = await runFullLatexPipeline({
    payload: req.payload,
    user,
    lessonId: lesson.id,
    mediaId: media.id,
    request: { url: req.url ?? '', headers: req.headers ?? new Headers() },
  })

  if (!pipeline.success) {
    // Lesson + media are LEFT IN PLACE so the admin can retry via the
    // "Full Convert (LaTeX)" button on the lesson edit view. Return
    // success:false in the result envelope (not an API error) so the UI
    // can still render an "Open lesson" link on the failed row.
    return {
      success: false,
      lessonId: lesson.id,
      lessonTitle,
      mediaId: media.id,
      exercisesCreated: 0,
      latexBlocksFailed: 0,
      warnings: pipeline.warnings,
      message: `${pipeline.error || 'LaTeX pipeline failed'} — open the lesson and click "Full Convert (LaTeX)" to retry.`,
    }
  }

  const message =
    pipeline.latexBlocksFailed > 0
      ? `Created ${pipeline.exerciseCount} exercises. ${pipeline.latexBlocksFailed} LaTeX block${
          pipeline.latexBlocksFailed === 1 ? '' : 's'
        } could not be converted — open the lesson and re-run Full Convert (LaTeX) to retry.`
      : undefined

  return {
    success: true,
    lessonId: lesson.id,
    lessonTitle,
    mediaId: media.id,
    exercisesCreated: pipeline.exerciseCount,
    latexBlocksFailed: pipeline.latexBlocksFailed,
    warnings: pipeline.warnings,
    message,
  }
}
