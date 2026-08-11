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

/** Toggle bold/italic on selection. Same-tag ancestor unwraps (Word-style). */
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
 * Wrap selection in a tokened <span>. Same-category ancestors are absorbed
 * (picking a new color replaces the old one; nesting `::green{::blue{...}}`
 * would corrupt storage since the outer regex closes on the inner `}`).
 * Align tokens land as a class on the enclosing block — <div>-in-<p> is
 * invalid and browsers auto-split it.
 */
export function applyToken(root: HTMLElement, token: AllToken): void {
  const range = currentRange(root)
  if (!range) return

  // Align is a block-level property, so applying it with just a caret
  // (no text selected) is the natural gesture — no need to require a range.
  if (isAlignToken(token)) {
    applyAlignToBlock(root, range, token)
    return
  }

  if (range.collapsed) return

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
  // Preserve block-level attrs like align-right — otherwise turning a right-
  // aligned <p> into a heading silently drops the alignment.
  const cls = block.getAttribute('class')
  if (cls) heading.setAttribute('class', cls)
  const dataToken = block.getAttribute('data-aguy-token')
  if (dataToken) heading.setAttribute('data-aguy-token', dataToken)
  block.replaceWith(heading)
  selectContents(heading)
  const sel = window.getSelection()
  sel?.getRangeAt(0).collapse(false)
}

export function clearFormatting(root: HTMLElement): void {
  const range = currentRange(root)
  if (!range || range.collapsed) return

  const isFormatting = (el: Element) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i') return true
    const cat = categoryOfElement(el)
    return cat !== null && cat !== 'align'
  }

  // Double-click a colored word → the wrapper is an ancestor of the range,
  // not a descendant of the extracted fragment. Unwrap those first.
  let ancestor = findAncestor(range, root, isFormatting)
  while (ancestor) {
    unwrap(ancestor)
    ancestor = findAncestor(range, root, isFormatting)
  }

  const contents = range.extractContents()
  stripDescendants(contents, isFormatting)
  range.insertNode(contents)
}
