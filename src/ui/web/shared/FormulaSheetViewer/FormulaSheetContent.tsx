/**
 * FormulaSheetContent
 *
 * @fileType component
 * @domain formula-sheets
 * @pattern content-renderer
 * @ai-summary Renders formula sheet content based on content type (PDF, RichText, or Blocks)
 */

'use client'

import type { FormulaSheet } from '@/payload-types'
import { RenderBlocks } from '@/server/payload/blocks/RenderBlocks'
import { useTranslations } from '@/ui/web/providers/I18n'
import RichText from '@/ui/web/RichText'

import { PDFEmbed } from '../../courses/PDFViewer/PDFEmbed'

export interface FormulaSheetContentProps {
  /** The formula sheet to render */
  sheet: FormulaSheet
}

/**
 * Render the content of a formula sheet based on its content type
 *
 * Supports three content types:
 * - pdf: Uses PDFEmbed component with zoom support
 * - richText: Uses RichText component for lexical content with LaTeX
 * - blocks: Uses RenderBlocks for HTML, Media, Table blocks
 */
export function FormulaSheetContent({ sheet }: FormulaSheetContentProps) {
  const { contentType, pdfFile, richTextContent, bodyBlocks } = sheet
  const t = useTranslations('courses')

  switch (contentType) {
    case 'pdf':
      if (!pdfFile || typeof pdfFile === 'string') {
        return <p className="text-muted-foreground">{t('formulaSheetEmpty')}</p>
      }
      return <PDFEmbed pdfUrl={pdfFile.url || `/media/${pdfFile.filename}`} title={sheet.title} />

    case 'richText':
      if (!richTextContent) {
        return <p className="text-muted-foreground">{t('formulaSheetEmpty')}</p>
      }
      return (
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <RichText data={richTextContent} enableProse={false} enableGutter={false} />
        </div>
      )

    case 'blocks':
    default:
      if (!bodyBlocks || !Array.isArray(bodyBlocks) || bodyBlocks.length === 0) {
        return <p className="text-muted-foreground">{t('formulaSheetEmpty')}</p>
      }
      return (
        <div className="formula-sheet-blocks">
          <RenderBlocks blocks={bodyBlocks} />
        </div>
      )
  }
}
