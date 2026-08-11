import {
  classForToken,
  tokenForClass,
  tokenCategory,
  type AllToken,
} from './wysiwyg-tokens'
import { findEnclosingBlock } from './wysiwyg-dom'

export function removeAlignFromBlock(block: Element): boolean {
  let removed = false
  for (const c of Array.from(block.classList)) {
    const tok = tokenForClass(c)
    if (tok && tokenCategory(tok) === 'align') {
      block.classList.remove(c)
      removed = true
    }
  }
  const attr = block.getAttribute('data-aguy-token')
  if (attr && tokenCategory(attr as AllToken) === 'align') {
    block.removeAttribute('data-aguy-token')
    removed = true
  }
  return removed
}

/**
 * Apply an align token to the block enclosing the range. Re-clicking the same
 * alignment toggles off (Word-style) — also the only UI path to unalign a
 * paragraph, since clearFormatting stays inline-scoped.
 */
export function applyAlignToBlock(root: HTMLElement, range: Range, token: AllToken): boolean {
  const block = findEnclosingBlock(range, root)
  if (!block) return false
  if (block.getAttribute('data-aguy-token') === token) return removeAlignFromBlock(block)
  removeAlignFromBlock(block)
  block.classList.add(classForToken(token))
  block.setAttribute('data-aguy-token', token)
  return true
}
