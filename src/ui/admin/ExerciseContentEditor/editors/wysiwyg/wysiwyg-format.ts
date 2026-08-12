import {
  isAlignToken,
  categoryOfElement,
  tokenCategory,
  classForToken,
  type AllToken,
} from './wysiwyg-tokens'
import {
  currentRange,
  unwrap,
  findAncestor,
  stripDescendants,
  selectContents,
  findEnclosingBlock,
  blocksInRange,
} from './wysiwyg-dom'
import { applyAlignToBlock, removeAlignFromBlock } from './wysiwyg-align'
import { forEachBlockRange, wrapMark, wrapToken } from './wysiwyg-per-block'

// Every action returns `true` when it mutated the DOM so the WysiwygEditor
// can skip a spurious onChange on no-op clicks (Bold with a bare caret
// otherwise wakes autosave / dirty-flag).

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
  return forEachBlockRange(range, root, (r) => wrapMark(r, tag))
}

// Wrap selection in a tokened <span>. Same-category ancestors are absorbed
// (green→blue replaces instead of nesting `::green{::blue{...}}`, which the
// outer regex would truncate at `}`). Align tokens go on the block — <div>
// inside <p> is invalid HTML.
export function applyToken(root: HTMLElement, token: AllToken): boolean {
  const range = currentRange(root)
  if (!range) return false

  if (isAlignToken(token)) {
    const blocks = blocksInRange(range, root)
    if (blocks.length === 0) return applyAlignToBlock(root, range, token)
    // On multi-block, decide add-all vs strip-all up front — per-block toggle
    // silently swaps mixed selections (aligned+unaligned → unaligned+aligned).
    // Only strip if every touched block already carries this exact token.
    const allAligned = blocks.every((b) => b.getAttribute('data-aguy-token') === token)
    let any = false
    for (const b of blocks) {
      if (allAligned) {
        if (removeAlignFromBlock(b)) any = true
      } else if (b.getAttribute('data-aguy-token') !== token) {
        removeAlignFromBlock(b)
        b.classList.add(classForToken(token))
        b.setAttribute('data-aguy-token', token)
        any = true
      }
    }
    return any
  }

  if (range.collapsed) return false

  const category = tokenCategory(token)
  const sameCategory = (el: Element) => categoryOfElement(el) === category
  const ancestor = findAncestor(range, root, sameCategory)
  if (ancestor) range.selectNode(ancestor)

  return forEachBlockRange(range, root, (r) => wrapToken(r, token, category))
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

  // Block-level align sits on the paragraph, not the range — clear on every
  // block the range touches (Ctrl+A + Clear must unalign all of them).
  const blocks = blocksInRange(range, root)
  let mutated = false
  for (const b of blocks) if (removeAlignFromBlock(b)) mutated = true

  if (range.collapsed) return mutated

  const isFormatting = (el: Element) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i') return true
    const cat = categoryOfElement(el)
    return cat !== null && cat !== 'align'
  }

  // Double-click a colored word → wrapper is an ancestor of the range, not a
  // descendant of the extracted fragment. Unwrap those first.
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
