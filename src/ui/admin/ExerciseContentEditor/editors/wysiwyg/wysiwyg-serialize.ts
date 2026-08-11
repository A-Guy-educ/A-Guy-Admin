import { tokenForClass } from './wysiwyg-tokens'

function serializeChildren(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    out += serializeNode(child)
  })
  return out
}

function serializeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()

  if (tag === 'br') return '\n'
  if (tag === 'strong' || tag === 'b') return `**${serializeChildren(el)}**`
  if (tag === 'em' || tag === 'i') return `*${serializeChildren(el)}*`
  // Only h1 has a UI + parser path. Narrow to h1 so an unexpected h2/h3 falls
  // through to serializeChildren rather than silently downgrading to `# `.
  if (tag === 'h1') return `# ${serializeChildren(el)}`

  const dataToken = el.getAttribute('data-aguy-token')
  if (dataToken) return `::${dataToken}{${serializeChildren(el)}}`

  const cls = el.getAttribute('class')
  if (cls) {
    for (const c of cls.split(/\s+/)) {
      const token = tokenForClass(c)
      if (token) return `::${token}{${serializeChildren(el)}}`
    }
  }

  return serializeChildren(el)
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  return serializeElement(node as Element)
}

function blockToken(el: Element): string | null {
  const dataToken = el.getAttribute('data-aguy-token')
  if (dataToken) return dataToken
  const cls = el.getAttribute('class')
  if (!cls) return null
  for (const c of cls.split(/\s+/)) {
    const token = tokenForClass(c)
    if (token) return token
  }
  return null
}

function isEffectivelyEmpty(inner: string): boolean {
  return inner === '' || inner === '\n'
}

/**
 * Serialize a contentEditable root back to md-math-v1 source.
 *
 * Empty paragraphs (`<p><br></p>`) serialize to blank lines rather than a
 * literal `\n` child — otherwise every save loop would double the blank-line
 * count (child `\n` plus `lines.join('\n')` separator) and drift stored md.
 */
export function serializeDomToMd(root: Element): string {
  const lines: string[] = []

  root.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const txt = child.textContent ?? ''
      if (txt) lines.push(txt)
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return

    const el = child as Element
    const tag = el.tagName.toLowerCase()

    if (tag === 'p' || tag === 'div') {
      const inner = serializeChildren(el)
      const token = blockToken(el)
      if (token) {
        lines.push(`::${token}{${isEffectivelyEmpty(inner) ? '' : inner}}`)
      } else {
        lines.push(isEffectivelyEmpty(inner) ? '' : inner)
      }
      return
    }

    lines.push(serializeElement(el))
  })

  return lines.join('\n')
}
