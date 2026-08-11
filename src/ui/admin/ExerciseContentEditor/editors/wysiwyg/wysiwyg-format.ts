import {
  classForToken,
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
import { applyAlignToBlock, removeAlignFromBlock } from './wysiwyg-align'

// Every action returns `true` when it mutated the DOM so the WysiwygEditor
// can skip a spurious onChange on no-op clicks (Bold with a bare caret would
// otherwise emit the same value and wake up autosave / dirty-flag).

/** Toggle bold/italic on selection. Same-tag ancestor unwraps (Word-style). */
export function applyInlineMark(root: HTMLElement, tag: 'strong' | 'em'): boolean {
  const range = currentRange(root)
  if (!range || range.collapsed) return false

  const matchTag = (el: Element) => el.tagName.toLowerCase() === tag
  const ancestor = findAncestor(range, root, matchTag)
  if (ancestor) {
    unwrap(ancestor)
    return true
  }

  const contents = range.extractContents()
  stripDescendants(contents, matchTag)
  const wrapper = document.createElement(tag)
  wrapper.appendChild(contents)
  range.insertNode(wrapper)
  selectContents(wrapper)
  return true
}

// Wrap selection in a tokened <span>. Same-category ancestors are absorbed
// (green→blue replaces instead of nesting `::green{::blue{...}}`, which the
// outer regex would truncate at the inner `}`). Align tokens go on the
// enclosing block — <div>-in-<p> is invalid and browsers auto-split it.
export function applyToken(root: HTMLElement, token: AllToken): boolean {
  const range = currentRange(root)
  if (!range) return false

  // Align is a block property — bare caret is fine, no selection required.
  if (isAlignToken(token)) return applyAlignToBlock(root, range, token)

  if (range.collapsed) return false

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
  return true
}

export function insertAround(root: HTMLElement, before: string, after: string): boolean {
  const range = currentRange(root)
  if (!range) return false

  const selected = range.toString()
  range.deleteContents()
  const wrapped = document.createTextNode(before + selected + after)
  range.insertNode(wrapped)

  const sel = window.getSelection()
  if (!sel) return true
  sel.removeAllRanges()
  const newRange = document.createRange()
  newRange.setStart(wrapped, before.length)
  newRange.setEnd(wrapped, before.length + selected.length)
  sel.addRange(newRange)
  return true
}

export function insertHeading(root: HTMLElement): boolean {
  const range = currentRange(root)
  if (!range) return false
  const block = findEnclosingBlock(range, root)
  if (!block) return false
  if (block.tagName.toLowerCase() === 'h1') return false

  const heading = document.createElement('h1')
  heading.innerHTML = block.innerHTML
  block.replaceWith(heading)
  selectContents(heading)
  const sel = window.getSelection()
  sel?.getRangeAt(0).collapse(false)
  return true
}

export function clearFormatting(root: HTMLElement): boolean {
  const range = currentRange(root)
  if (!range) return false

  // Block-level align is cleared regardless of whether text is selected — it
  // sits on the enclosing paragraph, not on the range itself.
  const block = findEnclosingBlock(range, root)
  const alignCleared = block ? removeAlignFromBlock(block) : false

  if (range.collapsed) return alignCleared

  const isFormatting = (el: Element) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i') return true
    const cat = categoryOfElement(el)
    return cat !== null && cat !== 'align'
  }

  let mutated = alignCleared
  // Double-click a colored word → the wrapper is an ancestor of the range,
  // not a descendant of the extracted fragment. Unwrap those first.
  let ancestor = findAncestor(range, root, isFormatting)
  while (ancestor) {
    unwrap(ancestor)
    mutated = true
    ancestor = findAncestor(range, root, isFormatting)
  }

  const contents = range.extractContents()
  const before = contents.querySelectorAll('*').length
  stripDescendants(contents, isFormatting)
  const stripped = contents.querySelectorAll('*').length !== before
  range.insertNode(contents)
  return mutated || stripped
}
