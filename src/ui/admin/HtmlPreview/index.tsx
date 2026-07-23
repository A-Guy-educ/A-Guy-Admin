'use client'

import {
  prepareHtmlDocumentSource,
  isFullHtmlDocument,
} from '@/server/payload/blocks/HtmlBlock/Component'

interface HtmlPreviewProps {
  html: string | null | undefined
}

/**
 * @deprecated Use `prepareHtmlDocumentSource` from
 * `@/server/payload/blocks/HtmlBlock/Component` instead. Kept for backwards
 * compatibility with admin components that imported it from here.
 */
export const prepareHtmlPreviewSource = prepareHtmlDocumentSource

/**
 * @deprecated Use `isFullHtmlDocument` from
 * `@/server/payload/blocks/HtmlBlock/Component` instead. Kept for backwards
 * compatibility with admin components that imported it from here.
 */
export const isFullHtmlPreviewDocument = isFullHtmlDocument

export const HtmlPreview: React.FC<HtmlPreviewProps> = ({ html }) => {
  const source = prepareHtmlDocumentSource(html)

  if (!source.trim()) {
    return <div className="html-block-preview-pane" />
  }

  if (isFullHtmlDocument(source)) {
    return (
      <iframe
        className="html-block-preview-pane html-block-preview-frame"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={source}
        title="HTML preview"
      />
    )
  }

  return <div className="html-block-preview-pane" dangerouslySetInnerHTML={{ __html: source }} />
}
