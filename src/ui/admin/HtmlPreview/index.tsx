'use client'

interface HtmlPreviewProps {
  html: string | null | undefined
}

export const prepareHtmlPreviewSource = (html: string | null | undefined): string => {
  const source = html || ''
  const documentStart = source.search(/<!doctype html|<html\b/i)

  return documentStart > 0 ? source.slice(documentStart) : source
}

export const isFullHtmlPreviewDocument = (html: string | null | undefined): boolean => {
  return /<!doctype html|<html\b|<body\b/i.test(prepareHtmlPreviewSource(html))
}

export const HtmlPreview: React.FC<HtmlPreviewProps> = ({ html }) => {
  const source = prepareHtmlPreviewSource(html)

  if (!source.trim()) {
    return <div className="html-block-preview-pane" />
  }

  if (isFullHtmlPreviewDocument(source)) {
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
