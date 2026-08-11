import { classForToken, tokenForClass, isAlignToken, type AllToken } from './wysiwyg-tokens'

function currentRange(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return range
}

function wrapRange(range: Range, wrapper: HTMLElement): void {
  const contents = range.extractContents()
  wrapper.appendChild(contents)
  range.insertNode(wrapper)

  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  const newRange = document.createRange()
  newRange.selectNodeContents(wrapper)
  sel.addRange(newRange)
}

export function applyInlineMark(root: HTMLElement, tag: 'strong' | 'em'): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return
  wrapRange(range, document.createElement(tag))
}

export function applyToken(root: HTMLElement, token: AllToken): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return

  const tagName = isAlignToken(token) ? 'div' : 'span'
  const wrapper = document.createElement(tagName)
  wrapper.className = classForToken(token)
  wrapper.setAttribute('data-aguy-token', token)
  wrapRange(range, wrapper)
}

/**
 * Insert literal `before + selection + after` at the current caret. Used for
 * source-only constructs (math `$...$`, code `` `...` ``, links) that don't
 * have a WYSIWYG representation in this first cut — users see and edit them
 * inline as text.
 */
export function insertAround(root: HTMLElement, before: string, after: string): void {
  const range = currentRange(root)
  if (!range) return

  const selected = range.toString()
  range.deleteContents()
  const wrapped = document.createTextNode(before + selected + after)
  range.insertNode(wrapped)

  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  const newRange = document.createRange()
  newRange.setStart(wrapped, before.length)
  newRange.setEnd(wrapped, before.length + selected.length)
  sel.addRange(newRange)
}

export function insertHeading(root: HTMLElement): void {
  const range = currentRange(root)
  if (!range) return

  let block: Node | null = range.startContainer
  while (block && block !== root && block.nodeType !== Node.ELEMENT_NODE) {
    block = block.parentNode
  }
  while (block && block.parentNode !== root) {
    block = block.parentNode
  }
  if (!block || block === root) return

  const el = block as Element
  const heading = document.createElement('h1')
  heading.innerHTML = el.innerHTML
  el.replaceWith(heading)

  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  const newRange = document.createRange()
  newRange.selectNodeContents(heading)
  newRange.collapse(false)
  sel.addRange(newRange)
}

/**
 * Strip tokened/inline formatting from the current selection. Walks up from
 * text nodes and unwraps any known formatting element (strong, em, or a
 * tokened span/div) so the selected text collapses back to plain prose.
 */
export function clearFormatting(root: HTMLElement): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return

  const contents = range.extractContents()
  const walker = document.createTreeWalker(contents, NodeFilter.SHOW_ELEMENT)
  const toUnwrap: Element[] = []

  let current = walker.nextNode() as Element | null
  while (current) {
    const tag = current.tagName.toLowerCase()
    const cls = current.getAttribute('class') ?? ''
    const isMark = tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i'
    const isToken =
      current.hasAttribute('data-aguy-token') ||
      cls.split(/\s+/).some((c) => tokenForClass(c) !== null)
    if (isMark || isToken) toUnwrap.push(current)
    current = walker.nextNode() as Element | null
  }

  for (const el of toUnwrap) {
    const parent = el.parentNode
    if (!parent) continue
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  }

  range.insertNode(contents)
}
