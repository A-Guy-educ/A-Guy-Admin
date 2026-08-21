import React from 'react'

import type { HtmlBlock as HtmlBlockProps } from '@/payload-types'

const FULL_DOCUMENT_PATTERN = /<!doctype\s+html|<html\b|<body\b/i
const BODY_CONTENT_PATTERN = /<body\b[^>]*>([\s\S]*?)<\/body>/i
const HEAD_CONTENT_PATTERN = /<head\b[^>]*>([\s\S]*?)<\/head>/i
const HEAD_STYLE_PATTERN = /<style\b[^>]*>[\s\S]*?<\/style>/gi
const DOCUMENT_START_PATTERN = /<!doctype\s+html|<html\b/i

export const prepareHtmlDocumentSource = (html: string | null | undefined): string => {
  const source = html || ''
  const documentStart = source.search(DOCUMENT_START_PATTERN)

  if (documentStart > 0) {
    return source.slice(documentStart)
  }

  return source
}

export const isFullHtmlDocument = (html: string | null | undefined): boolean => {
  const source = prepareHtmlDocumentSource(html)

  return FULL_DOCUMENT_PATTERN.test(source)
}

/**
 * For full HTML documents, keep only `<style>` tags from `<head>` plus the
 * content of `<body>`. For fragments, return the source unchanged. Returns an
 * empty string for nullish input so callers can use the result in
 * `dangerouslySetInnerHTML` without extra checks.
 */
export const prepareHtmlBlockMarkup = (html: string | null | undefined): string => {
  if (html == null) return ''

  const source = prepareHtmlDocumentSource(html)
  if (!source) return ''

  const bodyMatch = source.match(BODY_CONTENT_PATTERN)
  if (!bodyMatch) {
    return source
  }

  const headMatch = source.match(HEAD_CONTENT_PATTERN)
  const headStyles = headMatch?.[1].match(HEAD_STYLE_PATTERN) || []

  return [...headStyles, bodyMatch[1]].join('\n').trim()
}

export const HtmlBlock: React.FC<HtmlBlockProps> = ({ html }) => {
  if (!html) {
    return null
  }

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
