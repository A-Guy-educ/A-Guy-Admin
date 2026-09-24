import { describe, expect, it } from 'vitest'

import {
  isFullHtmlDocument,
  prepareHtmlBlockMarkup,
  prepareHtmlDocumentSource,
} from '@/server/payload/blocks/HtmlBlock/Component'

describe('prepareHtmlBlockMarkup', () => {
  it('detects and cleans full HTML documents', () => {
    const html = 'זסזס<!DOCTYPE html><html><body>שלום</body></html>'

    expect(isFullHtmlDocument(html)).toBe(true)
    expect(prepareHtmlDocumentSource(html)).toBe('<!DOCTYPE html><html><body>שלום</body></html>')
  })

  it('renders full HTML documents as head styles plus body content', () => {
    const html = `<!DOCTYPE html>
      <html lang="he" dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>Lesson</title>
          <link rel="stylesheet" href="https://example.com/styles.css">
          <script src="https://cdn.tailwindcss.com"></script>
          <style>.lesson { color: #961127; }</style>
        </head>
        <body>
          <main class="lesson" style="padding: 24px;">שלום</main>
        </body>
      </html>`

    const result = prepareHtmlBlockMarkup(html)

    expect(result).toContain('<style>.lesson { color: #961127; }</style>')
    expect(result).toContain('<main class="lesson" style="padding: 24px;">שלום</main>')
    expect(result).not.toContain('<title>')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('<link')
    expect(result).not.toContain('<meta')
  })

  it('leaves HTML fragments unchanged', () => {
    const html = '<section style="padding: 24px;">Fragment</section>'

    expect(prepareHtmlBlockMarkup(html)).toBe(html)
  })

  it('returns empty string for null/undefined input (issue #95)', () => {
    expect(prepareHtmlBlockMarkup(null)).toBe('')
    expect(prepareHtmlBlockMarkup(undefined)).toBe('')
    expect(prepareHtmlBlockMarkup('')).toBe('')
  })

  it('preserves fragments containing <body> tag without closing tag (issue #95)', () => {
    // When authors paste a malformed body tag, the source is preserved as-is
    // so the rendered output still reflects what the user typed.
    const html = '<body><div>Body content</div>'

    expect(prepareHtmlBlockMarkup(html)).toBe(html)
  })

  it('preserves fragments with only style and content (issue #95)', () => {
    const html = '<style>.x{color:red}</style><div>Content</div>'

    expect(prepareHtmlBlockMarkup(html)).toBe(html)
  })

  it('detects full documents by <body> alone (issue #95)', () => {
    expect(isFullHtmlDocument('<body>Content</body>')).toBe(true)
    expect(isFullHtmlDocument('<BODY>Content</BODY>')).toBe(true)
  })

  it('treats fragments without html/body as not full documents (issue #95)', () => {
    expect(isFullHtmlDocument('<div>Content</div>')).toBe(false)
    expect(isFullHtmlDocument('Plain text content')).toBe(false)
    expect(isFullHtmlDocument('')).toBe(false)
  })

  it('handles html content starting after the document marker (issue #95)', () => {
    const html = 'prefix text<!DOCTYPE html><html><body>Real content</body></html>'

    expect(prepareHtmlDocumentSource(html)).toBe(
      '<!DOCTYPE html><html><body>Real content</body></html>',
    )
    expect(isFullHtmlDocument(html)).toBe(true)
  })
})
