'use client'

import DOMPurify from 'dompurify'
import { useEffect, useMemo, useState } from 'react'
import { GuidedExplanationV1Schema } from '@/infra/contracts/guided-explanation/v1'
import type { HtmlBlock } from '@/server/payload/collections/Exercises/types'
import { registerPurifyHook, unregisterPurifyHook } from '@/ui/shared/primitives/DOMPurifyHooks'
import { GuidedExplanationRunner } from '@/ui/shared/GuidedExplanationRunner'

interface HtmlBlockRendererProps {
  block: HtmlBlock
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'ins',
    'mark',
    'sub',
    'sup',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'a',
    'img',
    'div',
    'section',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'class',
    'target',
    'rel',
    'width',
    'height',
    'colspan',
    'rowspan',
    'dir',
  ],
}

function prepareHtmlDocumentSource(html: string): string {
  const documentStart = html.search(/<!doctype html|<html\b/i)

  return documentStart > 0 ? html.slice(documentStart) : html
}

function isFullHtmlDocument(html: string): boolean {
  return /<!doctype html|<html\b|<body\b/i.test(prepareHtmlDocumentSource(html))
}

export function HtmlBlockRenderer({ block }: HtmlBlockRendererProps) {
  // When a guided explanation payload is present and valid, render the
  // trusted runner. safeParse guards against malformed data from DB
  // migrations or API bugs — falls back to static HTML on failure.
  if (block.guidedExplanation) {
    const parsed = GuidedExplanationV1Schema.safeParse(block.guidedExplanation)
    if (parsed.success) {
      return <GuidedExplanationRunner payload={parsed.data} />
    }
  }

  if (isFullHtmlDocument(block.html)) {
    return <FullHtmlDocumentRenderer html={block.html} />
  }

  return <StaticHtmlRenderer html={block.html} />
}

function FullHtmlDocumentRenderer({ html }: { html: string }) {
  return (
    <iframe
      className="html-block-content block min-h-[90vh] w-full rounded-lg border-0"
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={prepareHtmlDocumentSource(html)}
      title="HTML content"
    />
  )
}

function StaticHtmlRenderer({ html }: { html: string }) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    registerPurifyHook()
    setIsMounted(true)
    return () => {
      unregisterPurifyHook()
    }
  }, [])

  const cleanHtml = useMemo(() => {
    if (!isMounted || !html?.trim()) return ''
    return DOMPurify.sanitize(html, PURIFY_CONFIG)
  }, [isMounted, html])

  if (!cleanHtml) return null

  return <div className="html-block-content" dangerouslySetInnerHTML={{ __html: cleanHtml }} />
}
