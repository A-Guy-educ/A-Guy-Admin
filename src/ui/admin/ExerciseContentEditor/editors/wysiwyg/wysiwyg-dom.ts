/**
 * Low-level DOM/Selection helpers shared by wysiwyg-format's toolbar actions.
 * Kept split from wysiwyg-format so the public actions read as intent, not
 * plumbing.
 */

export function currentRange(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return range
}

export function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

export function findAncestor(
  range: Range,
  root: HTMLElement,
  predicate: (el: Element) => boolean,
): Element | null {
  let node: Node | null = range.commonAncestorContainer
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE && predicate(node as Element)) return node as Element
    node = node.parentNode
  }
  return null
}

export function stripDescendants(
  fragment: DocumentFragment,
  predicate: (el: Element) => boolean,
): void {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT)
  const toUnwrap: Element[] = []
  let n = walker.nextNode() as Element | null
  while (n) {
    if (predicate(n)) toUnwrap.push(n)
    n = walker.nextNode() as Element | null
  }
  for (const el of toUnwrap) unwrap(el)
}

export function selectContents(el: Element): void {
  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  const r = document.createRange()
  r.selectNodeContents(el)
  sel.addRange(r)
}

function blockContaining(
  node: Node,
  offset: number,
  root: HTMLElement,
  atEnd: boolean,
): Element | null {
  // Range endpoint IS the root (Ctrl+A on the wysiwyg): resolve to the child
  // block at `offset`. atEnd biases past the collection when offset points
  // one past the last child, so the end block still lands on the last block.
  if (node === root) {
    const idx = atEnd ? Math.max(0, offset - 1) : offset
    const child = root.childNodes[idx] ?? root.lastChild
    return child && child.nodeType === Node.ELEMENT_NODE ? (child as Element) : null
  }
  let cur: Node | null = node
  while (cur && cur.parentNode && cur.parentNode !== root) cur = cur.parentNode
  if (!cur || cur.parentNode !== root || cur.nodeType !== Node.ELEMENT_NODE) return null
  return cur as Element
}

export function findEnclosingBlock(range: Range, root: HTMLElement): Element | null {
  return blockContaining(range.startContainer, range.startOffset, root, false)
}

/**
 * Every top-level block the range touches — walk from the block containing
 * the start through next-siblings to the block containing the end. Used by
 * format actions so a Ctrl+A + Bold applies the mark to each paragraph
 * separately, instead of wrapping the block-level <p>s inside one <strong>
 * (which would silently mash paragraphs into a single line on serialize).
 */
export function blocksInRange(range: Range, root: HTMLElement): Element[] {
  const startBlock = blockContaining(range.startContainer, range.startOffset, root, false)
  const endBlock = blockContaining(range.endContainer, range.endOffset, root, true)
  if (!startBlock || !endBlock) return []
  if (startBlock === endBlock) return [startBlock]

  const out: Element[] = [startBlock]
  let cur: Node | null = startBlock.nextSibling
  while (cur && cur !== endBlock) {
    if (cur.nodeType === Node.ELEMENT_NODE) out.push(cur as Element)
    cur = cur.nextSibling
  }
  out.push(endBlock)
  return out
}

/**
 * Build a per-block sub-range for each block the outer range touches. The
 * first/last blocks preserve the outer range's start/end; middle blocks are
 * covered wholesale via selectNodeContents.
 */
export function subRangesPerBlock(range: Range, blocks: Element[]): Range[] {
  return blocks.map((block, i) => {
    const r = document.createRange()
    r.selectNodeContents(block)
    // Only borrow the outer range's endpoint when it actually falls inside
    // this block — a Ctrl+A range's endpoints reference the root, not the
    // per-block nodes, and setStart/End to those would extend the sub-range
    // past its block and produce wrong extractContents output.
    if (i === 0 && block.contains(range.startContainer)) {
      r.setStart(range.startContainer, range.startOffset)
    }
    if (i === blocks.length - 1 && block.contains(range.endContainer)) {
      r.setEnd(range.endContainer, range.endOffset)
    }
    return r
  })
}
