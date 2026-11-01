/**
 * Splits a v2 text field (`* טקסט:` / `* הנחיה:`) into plain-text and raw
 * HTML segments. Authors paste styled markup (e.g. a framed verse card) as
 * its own line(s) between narrative lines:
 *
 *   * טקסט:
 *   מה קורה בתחילת הסיפור?
 *   <div dir="rtl" style="…"><p>…</p></div>
 *
 * A segment starts on a line whose first non-blank character opens an HTML
 * tag, and runs until every element opened since then is closed again —
 * so markup spread over several lines stays one segment. `<svg>` is left as
 * text: inline SVG has its own `שרטוט` fields and no place in an html block.
 */

export interface TextSegment {
  kind: 'text' | 'html'
  value: string
}

const HTML_LINE_START_RE = /^\s*<([a-z][a-z0-9-]*)\b/i
const TAG_RE = /<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

function startsHtml(line: string): boolean {
  const m = line.match(HTML_LINE_START_RE)
  return !!m && m[1].toLowerCase() !== 'svg'
}

/** Net change in open-element depth across one line. */
function depthDelta(line: string): number {
  let delta = 0
  for (const [, closing, tag, selfClosing] of line.matchAll(TAG_RE)) {
    if (VOID_TAGS.has(tag.toLowerCase()) || selfClosing) continue
    delta += closing ? -1 : 1
  }
  return delta
}

export function splitHtmlSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let textLines: string[] = []
  let htmlLines: string[] = []
  let depth = 0

  const flushText = () => {
    const value = textLines.join('\n').trim()
    if (value) segments.push({ kind: 'text', value })
    textLines = []
  }
  const flushHtml = () => {
    const value = htmlLines.join('\n').trim()
    if (value) segments.push({ kind: 'html', value })
    htmlLines = []
    depth = 0
  }

  for (const line of text.split('\n')) {
    if (htmlLines.length === 0 && !startsHtml(line)) {
      textLines.push(line)
      continue
    }
    if (htmlLines.length === 0) flushText()
    htmlLines.push(line)
    depth += depthDelta(line)
    if (depth <= 0) flushHtml()
  }
  // Unbalanced markup at end of field — still an html segment, not text.
  flushHtml()
  flushText()
  return segments
}

/** Pulls the html segments out of a field, re-joining the remaining text. */
export function extractHtmlSegments(text: string): { text: string; html: string[] } {
  const segments = splitHtmlSegments(text)
  return {
    text: segments
      .filter((s) => s.kind === 'text')
      .map((s) => s.value)
      .join('\n\n'),
    html: segments.filter((s) => s.kind === 'html').map((s) => s.value),
  }
}
