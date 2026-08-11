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

export function findEnclosingBlock(range: Range, root: HTMLElement): Element | null {
  let block: Node | null = range.commonAncestorContainer
  while (block && block !== root) {
    if (block.parentNode === root && block.nodeType === Node.ELEMENT_NODE) return block as Element
    block = block.parentNode
  }
  return null
}
