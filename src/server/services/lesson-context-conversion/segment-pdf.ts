/**
 * PDF Segmentation Utilities
 *
 * Splits a PDF into page-range segments and extracts sub-PDF buffers
 * for per-segment LLM processing.
 *
 * @fileType utility
 * @domain conversion
 * @pattern pdf-processing
 */

import { PDFDocument } from 'pdf-lib'
import { getPageCount } from '@/server/utils/pdf-metadata'

export interface PdfSegment {
  pageStart: number // 1-based
  pageEnd: number // 1-based, inclusive
  pageCount: number
}

/**
 * Split a PDF into page-range segments.
 *
 * @param pdfBuffer - Full PDF buffer
 * @param maxPagesPerSegment - Max pages per segment (default 2)
 * @returns Array of page-range segments (1-based, inclusive)
 */
export async function segmentPdf(
  pdfBuffer: Buffer,
  maxPagesPerSegment: number = 2,
): Promise<PdfSegment[]> {
  const totalPages = await getPageCount(pdfBuffer)
  const segments: PdfSegment[] = []

  for (let start = 1; start <= totalPages; start += maxPagesPerSegment) {
    const end = Math.min(start + maxPagesPerSegment - 1, totalPages)
    segments.push({ pageStart: start, pageEnd: end, pageCount: end - start + 1 })
  }

  return segments
}

/**
 * Extract a sub-PDF containing only the specified page range.
 * Uses pdf-lib copyPages to produce a standalone PDF buffer.
 *
 * @param pdfBuffer - Full PDF buffer
 * @param pageStart - First page to include (1-based)
 * @param pageEnd - Last page to include (1-based, inclusive)
 * @returns Buffer containing only the requested pages
 */
export async function extractPdfPages(
  pdfBuffer: Buffer,
  pageStart: number,
  pageEnd: number,
): Promise<Buffer> {
  const uint8Array = new Uint8Array(pdfBuffer)
  const sourcePdf = await PDFDocument.load(uint8Array, {
    ignoreEncryption: true,
    updateMetadata: false,
  })

  const subPdf = await PDFDocument.create()

  // pdf-lib uses 0-based page indices
  const pageIndices = Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart - 1 + i)

  const copiedPages = await subPdf.copyPages(sourcePdf, pageIndices)
  for (const page of copiedPages) {
    subPdf.addPage(page)
  }

  const pdfBytes = await subPdf.save()
  return Buffer.from(pdfBytes)
}
