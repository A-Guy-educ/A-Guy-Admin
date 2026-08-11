import {
  classForToken,
  tokenForClass,
  isAlignToken,
  categoryOfElement,
  tokenCategory,
  type AllToken,
  type TokenCategory,
} from './wysiwyg-tokens'
import {
  currentRange,
  unwrap,
  findAncestor,
  stripDescendants,
  selectContents,
  findEnclosingBlock,
} from './wysiwyg-dom'

/**
 * Wrap the current selection in `<strong>` or `<em>`. If the selection is
 * already inside a same-tag ancestor we toggle it off — two clicks on Bold
 * mustn't produce `<strong><strong>`, which would serialize to `****text****`
 * and parse ambiguously on reload.
 */
export function applyInlineMark(root: HTMLElement, tag: 'strong' | 'em'): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return

  const matchTag = (el: Element) => el.tagName.toLowerCase() === tag
  const ancestor = findAncestor(range, root, matchTag)
  if (ancestor) {
    unwrap(ancestor)
    return
  }

  const contents = range.extractContents()
  stripDescendants(contents, matchTag)
  const wrapper = document.createElement(tag)
  wrapper.appendChild(contents)
  range.insertNode(wrapper)
  selectContents(wrapper)
}

function applyAlignToBlock(root: HTMLElement, range: Range, token: AllToken): void {
  const block = findEnclosingBlock(range, root)
  if (!block) return
  // Align is a single-slot property on the block; strip any prior align class
  // before setting the new one so re-clicking replaces instead of nesting.
  for (const c of Array.from(block.classList)) {
    const tok = tokenForClass(c)
    if (tok && tokenCategory(tok) === 'align') block.classList.remove(c)
  }
  block.classList.add(classForToken(token))
  block.setAttribute('data-aguy-token', token)
}

/**
 * Wrap the current selection in a tokened `<span>`. Same-category ancestors
 * (color-in-color, size-in-size) are absorbed by expanding the range and
 * stripping the old wrapper — picking a new color for the same range replaces
 * the previous one instead of nesting `::green{::blue{...}}`, which would
 * corrupt storage because the outer directive regex closes on the inner `}`.
 * Align tokens are applied as a class on the enclosing block instead, since a
 * `<div>` inside a `<p>` is invalid HTML and browsers auto-split it.
 */
export function applyToken(root: HTMLElement, token: AllToken): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return

  if (isAlignToken(token)) {
    applyAlignToBlock(root, range, token)
    return
  }

  const category: TokenCategory = tokenCategory(token)
  const sameCategory = (el: Element) => categoryOfElement(el) === category

  const ancestor = findAncestor(range, root, sameCategory)
  if (ancestor) range.selectNode(ancestor)

  const contents = range.extractContents()
  stripDescendants(contents, sameCategory)

  const wrapper = document.createElement('span')
  wrapper.className = classForToken(token)
  wrapper.setAttribute('data-aguy-token', token)
  wrapper.appendChild(contents)
  range.insertNode(wrapper)
  selectContents(wrapper)
}

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
  const block = findEnclosingBlock(range, root)
  if (!block) return

  const heading = document.createElement('h1')
  heading.innerHTML = block.innerHTML
  block.replaceWith(heading)
  selectContents(heading)
  const sel = window.getSelection()
  sel?.getRangeAt(0).collapse(false)
}

export function clearFormatting(root: HTMLElement): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return

  const contents = range.extractContents()
  stripDescendants(contents, (el) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i') return true
    const cat = categoryOfElement(el)
    return cat !== null && cat !== 'align'
  })
  range.insertNode(contents)
}
