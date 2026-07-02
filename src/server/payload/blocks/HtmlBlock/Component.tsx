import React from 'react'

import type { HtmlBlock as HtmlBlockProps } from '@/payload-types'

export const prepareHtmlDocumentSource = (html: string | null | undefined): string => {
  const source = html || ''
  const documentStart = source.search(/<!doctype html|<html\b/i)

  if (documentStart > 0) {
    return source.slice(documentStart)
  }

  return source
}

export const isFullHtmlDocument = (html: string | null | undefined): boolean => {
  const source = prepareHtmlDocumentSource(html)

  return /<!doctype html|<html\b|<body\b/i.test(source)
}

export const prepareHtmlBlockMarkup = (html: string | null | undefined): string => {
  const source = prepareHtmlDocumentSource(html)
  const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)

  if (!bodyMatch) {
    return source
  }

  const headMatch = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)
  const headStyles = headMatch?.[1].match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []

  return [...headStyles, bodyMatch[1]].join('\n').trim()
}

export const HtmlBlock: React.FC<HtmlBlockProps> = ({ html }) => {
  if (isFullHtmlDocument(html)) {
    return (
      <div className="container my-16 html-block">
        <iframe
          className="block w-full rounded-lg border-0"
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={prepareHtmlDocumentSource(html)}
          title="HTML content"
          style={{ minHeight: '90vh' }}
        />
      </div>
    )
  }

  return (
    <div
      className="container my-16 html-block"
      dangerouslySetInnerHTML={{ __html: prepareHtmlBlockMarkup(html) }}
    />
  )
}
