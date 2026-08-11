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
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') return `# ${serializeChildren(el)}`

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

/**
 * Serialize a contentEditable root back to md-math-v1 source.
 *
 * Block-level nodes (`<p>`, `<div>`, `<h1>`) become paragraph lines separated
 * by `\n`. Inline nodes (`<strong>`, `<em>`, tokened spans) become their
 * markdown/directive equivalents. Empty paragraphs render as blank lines so
 * users can compose multi-line prose with obvious separation.
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
      // Preserve empty paragraphs as blank lines so line breaks survive round-trips.
      const inner = serializeChildren(el)
      const dataToken = el.getAttribute('data-aguy-token')
      if (dataToken) {
        lines.push(`::${dataToken}{${inner}}`)
      } else {
        lines.push(inner)
      }
      return
    }

    lines.push(serializeElement(el))
  })

  return lines.join('\n')
}
