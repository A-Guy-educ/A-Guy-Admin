import {
  classForToken,
  categoryOfElement,
  type AllToken,
  type TokenCategory,
} from './wysiwyg-tokens'
import { stripDescendants, selectContents, blocksInRange, subRangesPerBlock } from './wysiwyg-dom'

/**
 * Apply `fn` to each block the range touches. Ctrl+A + Bold would otherwise
 * wrap sibling <p>s inside a single <strong>, which serialize collapses to
 * `**helloworld**` — silent paragraph merge. Walk last→first so wrapping the
 * earlier block doesn't invalidate the range anchors of later blocks.
 */
export function forEachBlockRange(
  range: Range,
  root: HTMLElement,
  fn: (r: Range) => boolean,
): boolean {
  const blocks = blocksInRange(range, root)
  if (blocks.length === 0) return false
  if (blocks.length === 1) return fn(range)
  const subs = subRangesPerBlock(range, blocks)
  let mutated = false
  for (let i = subs.length - 1; i >= 0; i--) if (fn(subs[i])) mutated = true
  // Each per-block wrap called selectContents on its own wrapper; the last
  // one to fire is block[0], so the visible selection would collapse to just
  // paragraph 1. Restore a range spanning every touched block so a follow-up
  // format click (Italic after Bold) hits the same content as the original.
  if (mutated) {
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      const r = document.createRange()
      r.setStart(blocks[0], 0)
      r.setEnd(blocks[blocks.length - 1], blocks[blocks.length - 1].childNodes.length)
      sel.addRange(r)
    }
  }
  return mutated
}

export function wrapMark(range: Range, tag: 'strong' | 'em'): boolean {
  if (range.collapsed) return false
  const contents = range.extractContents()
  stripDescendants(contents, (el) => el.tagName.toLowerCase() === tag)
  const wrapper = document.createElement(tag)
  wrapper.appendChild(contents)
  range.insertNode(wrapper)
  selectContents(wrapper)
  return true
}

export function wrapToken(range: Range, token: AllToken, category: TokenCategory): boolean {
  if (range.collapsed) return false
  const sameCategory = (el: Element) => categoryOfElement(el) === category
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
