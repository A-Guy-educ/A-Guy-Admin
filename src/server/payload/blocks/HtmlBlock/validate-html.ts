/**
 * @fileType utility
 * @ai-summary HTML validation for HtmlBlock - admin-authored rich HTML.
 *
 * SECURITY NOTE: This block is admin-only. Full HTML documents are accepted,
 * but only <style> tags from <head> and <body> content are rendered.
 */
export const validateHtml = (value: string | null | undefined): string | true => {
  if (!value || typeof value !== 'string') {
    return 'HTML content is required'
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return 'HTML content is required'
  }

  // Full-page HTML exports often include scripts/links in <head>. The renderer
  // only keeps <style> tags from the head plus the body content, so validate the
  // rendered portion instead of rejecting the whole paste.
  const renderedHtml = trimmed.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')

  const dangerousTags = ['<script', '<iframe', '<object', '<embed', '<applet', '<base']

  for (const tag of dangerousTags) {
    if (renderedHtml.toLowerCase().includes(tag)) {
      return `HTML contains blocked content: ${tag}`
    }
  }

  const eventHandlerPattern = /\bon\w+\s*=/gi
  const eventMatch = eventHandlerPattern.exec(renderedHtml)
  if (eventMatch) {
    return `inline event handlers are not allowed: ${eventMatch[0]}`
  }

  const jsUrlPattern = /(?:href|src)\s*=\s*["']?\s*javascript:/gi
  const jsMatch = jsUrlPattern.exec(renderedHtml)
  if (jsMatch) {
    return `javascript: URLs are not allowed: ${jsMatch[0]}`
  }

  return true
}
