'use client'

import DOMPurify from 'isomorphic-dompurify'

interface HtmlBlockRendererProps {
  block: {
    type: 'html'
    html: string
  }
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

// Force rel="noopener noreferrer" on links with target attribute to prevent tabnapping
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function HtmlBlockRenderer({ block }: HtmlBlockRendererProps) {
  if (!block.html?.trim()) return null

  const cleanHtml = DOMPurify.sanitize(block.html, PURIFY_CONFIG)

  return <div className="html-block-content" dangerouslySetInnerHTML={{ __html: cleanHtml }} />
}
