import type { PayloadRequest, User } from 'payload'

import { deriveLessonTitle } from '../text-lesson-import/convert-text-exercise'

export type LessonType = 'learning' | 'practice' | 'exam'

export interface ImportPdfLessonInput {
  chapterId: string
  filename: string
  /** Raw PDF bytes, base64-encoded for JSON transport. */
  pdfBase64: string
  lessonType?: LessonType
}

export interface ImportPdfLessonResult {
  success: boolean
  lessonId: string
  lessonTitle: string
  mediaId: string
  message?: string
}

export interface ImportPdfLessonNotFoundError {
  kind: 'not_found'
  message: string
}

export interface ImportPdfLessonValidationError {
  kind: 'validation'
  issues: Array<{ path: string; message: string }>
}

export type ImportPdfLessonError = ImportPdfLessonNotFoundError | ImportPdfLessonValidationError

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

export async function importPdfLessonFromFile(
  req: PayloadRequest,
  user: User,
  input: ImportPdfLessonInput,
): Promise<ImportPdfLessonResult | ImportPdfLessonError> {
  let buffer: Buffer
  try {
    buffer = Buffer.from(input.pdfBase64, 'base64')
  } catch {
    return {
      kind: 'validation',
      issues: [{ path: 'pdfBase64', message: 'Could not decode base64 PDF payload' }],
    }
  }
  if (buffer.length === 0) {
    return {
      kind: 'validation',
      issues: [{ path: 'pdfBase64', message: 'PDF file is empty' }],
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

  const lessonTitle = deriveLessonTitle({ filename: input.filename })

  // Media first so the lesson can reference it in contentFiles without a
  // second update round-trip. If the lesson create fails later we best-effort
  // delete this media so no orphaned blobs accumulate — same pattern as the
  // LaTeX importer.
  const media = await req.payload.create({
    collection: 'media',
    data: {
      filename: input.filename,
      mimeType: 'application/pdf',
      filesize: buffer.length,
      alt: lessonTitle,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    file: {
      data: buffer,
      mimetype: 'application/pdf',
      name: input.filename,
      size: buffer.length,
    },
    req,
    overrideAccess: true,
    user,
  })

  const order = await resolveLessonOrder(req, input.chapterId)

  let lesson
  try {
    lesson = await req.payload.create({
      collection: 'lessons',
      data: {
        locale: 'he',
        chapter: input.chapterId,
        type: input.lessonType ?? 'learning',
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
  } catch (err) {
    try {
      await req.payload.delete({
        collection: 'media',
        id: media.id,
        req,
        overrideAccess: true,
      })
    } catch {
      /* best-effort */
    }
    throw err
  }

  return {
    success: true,
    lessonId: lesson.id,
    lessonTitle,
    mediaId: media.id,
  }
}
