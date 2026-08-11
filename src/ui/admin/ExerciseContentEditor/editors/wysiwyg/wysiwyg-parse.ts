import { ALL_TOKENS, classForToken, isAlignToken, type AllToken } from './wysiwyg-tokens'

const DIRECTIVE_RE =
  /::(text-(?:wine-red|blue|green|dark-orange|size-(?:small|normal|large|xlarge)|align-right))\{([^}]*)\}/
const BOLD_RE = /\*\*([^*\n]+)\*\*/
const ITALIC_RE = /(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseInline(text: string): string {
  const boldMatch = text.match(BOLD_RE)
  const italicMatch = text.match(ITALIC_RE)
  const directiveMatch = text.match(DIRECTIVE_RE)

  const matches = [
    boldMatch && { index: boldMatch.index!, length: boldMatch[0].length, kind: 'bold' as const, inner: boldMatch[1] },
    italicMatch && { index: italicMatch.index!, length: italicMatch[0].length, kind: 'italic' as const, inner: italicMatch[1] },
    directiveMatch && { index: directiveMatch.index!, length: directiveMatch[0].length, kind: 'directive' as const, token: directiveMatch[1] as AllToken, inner: directiveMatch[2] },
  ].filter((m): m is NonNullable<typeof m> => m !== null)

  if (matches.length === 0) return escapeHtml(text)

  matches.sort((a, b) => a.index - b.index)
  const first = matches[0]
  const before = text.slice(0, first.index)
  const after = text.slice(first.index + first.length)

  const middle = renderMatch(first)
  return escapeHtml(before) + middle + parseInline(after)
}

function renderMatch(m: { kind: 'bold' | 'italic' | 'directive'; inner: string; token?: AllToken }): string {
  if (m.kind === 'bold') return `<strong>${parseInline(m.inner)}</strong>`
  if (m.kind === 'italic') return `<em>${parseInline(m.inner)}</em>`
  const token = m.token!
  if (!(ALL_TOKENS as readonly string[]).includes(token)) return escapeHtml(m.inner)
  const tag = isAlignToken(token) ? 'div' : 'span'
  return `<${tag} class="${classForToken(token)}" data-aguy-token="${token}">${parseInline(m.inner)}</${tag}>`
}

function parseBlock(line: string): string {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('# ')) {
    return `<h1>${parseInline(trimmed.slice(2))}</h1>`
  }
  return `<p>${parseInline(line) || '<br>'}</p>`
}

export function parseMdToHtml(source: string): string {
  if (!source) return '<p><br></p>'
  const lines = source.split('\n')
  return lines.map(parseBlock).join('')
}
